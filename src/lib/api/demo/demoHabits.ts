/**
 * Demo stand-ins for the habit profile: the real pure core over the in-memory DB, and a
 * dictionary-based "learn-style" (no AI) run through the same clean-up as the server.
 */
import {
  aliasMatch,
  computeProfile,
  type HabitAnswers,
  type HabitTask,
  type VocabEntry,
} from '../../../../supabase/functions/_shared/habits-core.ts';
import { normalizeLearn } from '../../../../supabase/functions/_shared/learn-style-core.ts';
import { normalizeVi } from '../../../../supabase/functions/_shared/vi-parse.ts';
import type { ParseTaskResponse } from '../types';
import type { DemoDb } from './demoDb';

function enabled(db: DemoDb): boolean {
  return db.table('habit_settings')[0]?.learning_enabled !== false;
}

export function demoHabitProfile(db: DemoDb, tz: string, now: number) {
  if (!enabled(db)) return null;
  const answers = (db.table('habit_settings')[0]?.answers ?? {}) as HabitAnswers;
  const names = Object.fromEntries(db.table('collections').map((c) => [String(c.id), String(c.name)]));
  return computeProfile({
    tasks: db.table('tasks').filter((t) => t.status === 'done') as unknown as HabitTask[],
    labels: { study: 'Học tập', work: 'Công việc', ...names },
    answers,
    tz,
    now,
  });
}

/** Learned nicknames beat the rule-based guess, like on the server. */
export function applyDemoAlias(db: DemoDb, res: ParseTaskResponse, text: string): ParseTaskResponse {
  if (!enabled(db)) return res;
  const vocab = db.table('vocab_entries') as unknown as VocabEntry[];
  const cols = db.table('collections');
  return {
    ...res,
    tasks: res.tasks.map((t) => {
      const hit = aliasMatch(t.title, vocab) ?? (res.tasks.length === 1 ? aliasMatch(text, vocab) : null);
      const col = hit?.collection_id ? cols.find((c) => c.id === hit.collection_id) : undefined;
      return col
        ? {
            ...t,
            collection_id: String(col.id),
            space: col.space as 'study' | 'work',
            space_uncertain: false,
            collection_name: String(col.name),
          }
        : t;
    }),
  };
}

const COMMON: Record<string, string> = {
  bt: 'bài tập',
  btvn: 'bài tập về nhà',
  dl: 'deadline',
  ktra: 'kiểm tra',
  kt: 'kiểm tra',
  gk: 'giữa kỳ',
  ck: 'cuối kỳ',
  tl: 'tài liệu',
  bc: 'báo cáo',
  slide: 'slide thuyết trình',
  gv: 'giảng viên',
  sv: 'sinh viên',
  ko: 'không',
  k: 'không',
  dc: 'được',
  vs: 'với',
  ntn: 'như thế nào',
  hnay: 'hôm nay',
  t2: 'thứ hai',
  cv: 'công việc',
  kh: 'khách hàng',
  sếp: 'quản lý',
};

export function demoLearnStyle(db: DemoDb, body: Record<string, unknown>) {
  const text = String(body.text ?? '');
  if (text.trim().length < 20) return { status: 400, error: 'bad_request' as const };
  const cols = db.table('collections').filter((c) => !c.archived) as unknown as { id: string; name: string }[];
  const words = new Set(
    normalizeVi(text)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const terms: { short: string; meaning: string; collection_name: string | null }[] = [];
  for (const c of cols) {
    const initials = normalizeVi(c.name)
      .split(/\s+/)
      .map((w) => w[0])
      .join('');
    if (initials.length >= 2 && words.has(initials)) terms.push({ short: initials, meaning: c.name, collection_name: c.name });
  }
  for (const [k, v] of Object.entries(COMMON))
    if (k.length >= 2 && words.has(normalizeVi(k))) terms.push({ short: k, meaning: v, collection_name: null });
  const known = db.table('vocab_entries').map((v) => String(v.short));
  return { data: { terms: normalizeLearn({ terms }, text, cols, known), provider: 'demo' }, status: 200, error: null };
}
