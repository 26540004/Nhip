/**
 * Loads the user's habit profile for an AI request (Deno; RLS user client).
 * Returns a neutral object when learning is off, so callers never branch on null.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aliasMatch,
  computeProfile,
  type Correction,
  estimateFactor,
  type HabitAnswers,
  type HabitProfile,
  type HabitTask,
  habitsPrompt,
  type Space,
  type VocabEntry,
} from './habits-core.ts';

export interface Habits {
  enabled: boolean;
  profile: HabitProfile | null;
  vocab: VocabEntry[];
  prompt: (use: 'parse' | 'plan' | 'split' | 'notes') => string;
  factor: (task: { space: Space; collection_id: string | null }) => number;
  alias: (text: string) => VocabEntry | null;
}

const OFF: Habits = { enabled: false, profile: null, vocab: [], prompt: () => '', factor: () => 1, alias: () => null };

export async function loadHabits(db: SupabaseClient, tz: string, privacy: boolean, now = Date.now()): Promise<Habits> {
  try {
    const since = new Date(now - 120 * 86_400_000).toISOString();
    const [settings, tasks, cols, vocab, corrections] = await Promise.all([
      db.from('habit_settings').select('learning_enabled, answers').maybeSingle(),
      db
        .from('tasks')
        .select('id, space, collection_id, estimate_minutes, actual_minutes, status, completed_at')
        .eq('status', 'done')
        .gte('completed_at', since)
        .limit(1000),
      db.from('collections').select('id, name'),
      db.from('vocab_entries').select('id, short, meaning, collection_id, source').order('created_at', { ascending: false }).limit(60),
      db
        .from('ai_corrections')
        .select('input_text, field, ai_value, user_value, created_at')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    if (settings.data && settings.data.learning_enabled === false) return OFF;
    const names = new Map<string, string>((cols.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const labels: Record<string, string> = { study: 'Học tập', work: 'Công việc', ...Object.fromEntries(names) };
    const profile = computeProfile({
      tasks: (tasks.data ?? []) as HabitTask[],
      labels,
      answers: (settings.data?.answers ?? {}) as HabitAnswers,
      tz,
      now,
    });
    const v = (vocab.data ?? []) as VocabEntry[];
    const c = (corrections.data ?? []) as Correction[];
    return {
      enabled: true,
      profile,
      vocab: v,
      prompt: (use) => habitsPrompt({ profile, vocab: v, corrections: c, collectionName: (id) => names.get(id) ?? null, privacy }, use),
      factor: (t) => estimateFactor(profile, t),
      alias: (text) => aliasMatch(text, v),
    };
  } catch {
    // Habits only improve suggestions; never fail a request because of them.
    return OFF;
  }
}
