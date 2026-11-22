/**
 * "Nhịp hiểu về bạn": habit profile data for the app.
 * The profile itself is computed on the device from the user's finished tasks with the same
 * pure core the server uses, so what the page shows is exactly what the AI gets.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  computeProfile,
  type Correction,
  type HabitAnswers,
  type HabitProfile,
  type HabitTask,
  type VocabEntry,
} from '../../../supabase/functions/_shared/habits-core.ts';
import { invoke } from './functions';
import { newId, useQueuedWrite } from './mutations';
import { requireSupabase, unwrap } from './supabase';

export type { HabitAnswers, HabitProfile, VocabEntry } from '../../../supabase/functions/_shared/habits-core.ts';

export type VocabRow = Pick<VocabEntry, 'id' | 'short' | 'meaning' | 'collection_id' | 'source'>;
export type CorrectionRow = Pick<Correction, 'input_text' | 'field' | 'ai_value' | 'user_value'> & { id: string };
export type CorrectionItem = Correction & { id: string };

export interface HabitsBundle {
  learningEnabled: boolean;
  answers: HabitAnswers;
  /** Has the user answered (or skipped) the quick questions? */
  answered: boolean;
  vocab: VocabRow[];
  corrections: CorrectionItem[];
  profile: HabitProfile;
}

export const habitsKey = ['habits'] as const;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';

export async function fetchHabits(): Promise<HabitsBundle> {
  const db = requireSupabase();
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [settings, tasks, cols, vocab, corrections] = await Promise.all([
    db.from('habit_settings').select('learning_enabled, answers').maybeSingle(),
    db
      .from('tasks')
      .select('id, space, collection_id, estimate_minutes, actual_minutes, status, completed_at')
      .eq('status', 'done')
      .gte('completed_at', since)
      .limit(1000),
    db.from('collections').select('id, name'),
    db.from('vocab_entries').select('id, short, meaning, collection_id, source').order('created_at', { ascending: false }),
    db
      .from('ai_corrections')
      .select('id, input_text, field, ai_value, user_value, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  if (settings.error) throw settings.error;
  const names = Object.fromEntries(((unwrap(cols) ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const answers = (settings.data?.answers ?? {}) as HabitAnswers;
  return {
    learningEnabled: settings.data?.learning_enabled ?? true,
    answers,
    answered: Object.keys(answers).length > 0,
    vocab: (unwrap(vocab) ?? []) as VocabRow[],
    corrections: (unwrap(corrections) ?? []) as CorrectionItem[],
    profile: computeProfile({
      tasks: (unwrap(tasks) ?? []) as HabitTask[],
      labels: { study: 'Học tập', work: 'Công việc', ...names },
      answers,
      tz: TZ,
      now: Date.now(),
    }),
  };
}

export function useHabits(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: habitsKey, queryFn: fetchHabits, staleTime: 5 * 60_000, enabled: opts.enabled ?? true });
}

function useOptimistic() {
  const qc = useQueryClient();
  return async (fn: (b: HabitsBundle) => HabitsBundle) => {
    await qc.cancelQueries({ queryKey: habitsKey });
    qc.setQueryData<HabitsBundle>(habitsKey, (old) => (old ? fn(old) : old));
  };
}

export function useSaveHabitSettings() {
  const opt = useOptimistic();
  return useQueuedWrite<{ learning_enabled?: boolean; answers?: HabitAnswers }>('habitSettingsUpsert', {
    invalidate: habitsKey,
    onMutate: (v) =>
      opt((b) => ({
        ...b,
        learningEnabled: v.learning_enabled ?? b.learningEnabled,
        answers: v.answers ?? b.answers,
        answered: v.answers ? true : b.answered,
      })),
  });
}

export function useAddVocab() {
  const opt = useOptimistic();
  return useQueuedWrite<VocabRow[]>('vocabCreate', {
    invalidate: habitsKey,
    onMutate: (rows) =>
      opt((b) => {
        const have = new Set(b.vocab.map((v) => v.short.trim().toLowerCase()));
        return { ...b, vocab: [...rows.filter((r) => !have.has(r.short.trim().toLowerCase())), ...b.vocab] };
      }),
  });
}

export function useDeleteVocab() {
  const opt = useOptimistic();
  return useQueuedWrite<string>('vocabDelete', {
    invalidate: habitsKey,
    onMutate: (id) => opt((b) => ({ ...b, vocab: b.vocab.filter((v) => v.id !== id) })),
  });
}

export function useDeleteCorrection() {
  const opt = useOptimistic();
  return useQueuedWrite<string>('correctionDelete', {
    invalidate: habitsKey,
    onMutate: (id) => opt((b) => ({ ...b, corrections: b.corrections.filter((c) => c.id !== id) })),
  });
}

export function useResetHabits() {
  const opt = useOptimistic();
  return useQueuedWrite<void>('habitsReset', {
    invalidate: habitsKey,
    onMutate: () => opt((b) => ({ ...b, vocab: [], corrections: [], answers: {}, answered: false, learningEnabled: true })),
  });
}

export const vocabRow = (short: string, meaning: string, collection_id: string | null, source: VocabRow['source']): VocabRow => ({
  id: newId(),
  short: short.trim(),
  meaning: meaning.trim(),
  collection_id,
  source,
});

export interface LearnedTermDto {
  short: string;
  meaning: string;
  collection_id: string | null;
}

export function learnStyle(text: string): Promise<{ terms: LearnedTermDto[]; provider: string }> {
  return invoke('learn-style', { text });
}
