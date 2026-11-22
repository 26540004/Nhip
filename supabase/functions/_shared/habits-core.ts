/**
 * "Hồ sơ thói quen" (pure; shared by the Edge Functions, the app and Jest).
 *
 * Code learns from the user's own data — no model training:
 *  - estimate accuracy: actual vs estimated minutes (evening review), per space and per
 *    subject/project, shrunk toward the user's self-report until there is enough data;
 *  - focus hours: when tasks actually get finished, per space, in 2-hour windows;
 *  - vocabulary: abbreviations and nicknames for subjects/projects (user, learned, imported);
 *  - corrections: what the user changed after Quick Add, replayed as examples.
 * The result is (1) applied deterministically (plan durations, subject aliases) and
 * (2) summarised for every AI prompt. Validation rules still apply to everything AI returns.
 */
import { normalizeVi } from './vi-parse.ts';

export type Space = 'study' | 'work';

export interface HabitTask {
  id: string;
  space: Space;
  collection_id: string | null;
  estimate_minutes: number | null;
  actual_minutes: number | null;
  status: string;
  completed_at: string | null;
}

export interface VocabEntry {
  id: string;
  short: string;
  meaning: string;
  collection_id: string | null;
  source: 'user' | 'learned' | 'import';
}

export interface Correction {
  input_text: string;
  field: 'collection' | 'space' | 'deadline' | 'estimate' | 'title';
  ai_value: string | null;
  user_value: string | null;
  created_at: string;
}

export interface HabitAnswers {
  /** Self-report from the quick-start questions. */
  overrun?: 'often' | 'sometimes' | 'rarely';
  focus_study?: Period[];
  focus_work?: Period[];
  /** "Để sau" on the Today card (synced, so it stays dismissed on every device). */
  skipped?: boolean;
}
export type Period = 'morning' | 'afternoon' | 'evening' | 'night';
export const PERIODS: Record<Period, [number, number]> = { morning: [6, 12], afternoon: [12, 18], evening: [18, 22], night: [22, 26] };

export interface EstimateStat {
  key: string; // 'study' | 'work' | collection id
  label: string;
  ratio: number; // actual / estimated
  n: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface FocusWindow {
  space: Space;
  /** local start hour of a 2-hour window (e.g. 20 = 20:00–22:00) */
  hour: number;
  share: number; // fraction of completions in this window
  n: number;
}

export interface HabitProfile {
  estimates: EstimateStat[];
  focus: FocusWindow[];
  completedSample: number;
  computedAt: number;
}

const PRIOR_WEIGHT = 3; // pseudo-tasks pulling the ratio toward the prior
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

export function priorRatio(a: HabitAnswers): number {
  return a.overrun === 'often' ? 1.3 : a.overrun === 'sometimes' ? 1.15 : 1;
}

function confidence(n: number): EstimateStat['confidence'] {
  return n >= 8 ? 'high' : n >= 3 ? 'medium' : 'low';
}

export function estimateStats(
  tasks: readonly HabitTask[],
  labels: Record<string, string>,
  answers: HabitAnswers,
  now: number,
): EstimateStat[] {
  const since = now - 120 * 86_400_000;
  const done = tasks.filter(
    (t) =>
      t.estimate_minutes &&
      t.estimate_minutes > 0 &&
      t.actual_minutes &&
      t.actual_minutes > 0 &&
      (!t.completed_at || Date.parse(t.completed_at) >= since),
  );
  const prior = priorRatio(answers);
  const groups = new Map<string, HabitTask[]>();
  for (const t of done) {
    groups.set(t.space, [...(groups.get(t.space) ?? []), t]);
    if (t.collection_id) groups.set(t.collection_id, [...(groups.get(t.collection_id) ?? []), t]);
  }
  const out: EstimateStat[] = [];
  for (const space of ['study', 'work'] as const) {
    const list = groups.get(space) ?? [];
    out.push(stat(space, labels[space] ?? space, list, prior));
  }
  for (const [key, list] of groups) {
    if (key === 'study' || key === 'work' || list.length < 3) continue;
    const spaceStat = out.find((s) => s.key === list[0]!.space)!;
    out.push(stat(key, labels[key] ?? key, list, spaceStat.ratio));
  }
  return out;
}

function stat(key: string, label: string, list: readonly HabitTask[], prior: number): EstimateStat {
  const sumE = list.reduce((s, t) => s + t.estimate_minutes!, 0);
  const sumA = list.reduce((s, t) => s + clamp(t.actual_minutes!, t.estimate_minutes! * 0.25, t.estimate_minutes! * 4), 0);
  const mean = list.length ? sumE / list.length : 60;
  const ratio = (sumA + PRIOR_WEIGHT * mean * prior) / (sumE + PRIOR_WEIGHT * mean);
  return { key, label, ratio: round2(clamp(ratio, 0.6, 2.2)), n: list.length, confidence: confidence(list.length) };
}

/** Local hour (0–23) and weekday for an instant in a fixed-offset or IANA zone. */
function localHour(ms: number, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(ms)) % 24;
}

export function focusWindows(tasks: readonly HabitTask[], tz: string, now: number, answers: HabitAnswers): FocusWindow[] {
  const since = now - 60 * 86_400_000;
  const out: FocusWindow[] = [];
  for (const space of ['study', 'work'] as const) {
    const done = tasks.filter((t) => t.space === space && t.completed_at && Date.parse(t.completed_at) >= since);
    const counts = new Map<number, number>();
    for (const t of done) {
      const h = localHour(Date.parse(t.completed_at!), tz);
      // Credit the 2 hours before the completion: work happens before "Xong" is tapped.
      const start = Math.floor(Math.max(0, h - 1) / 2) * 2;
      counts.set(start, (counts.get(start) ?? 0) + 1);
    }
    if (done.length >= 5) {
      for (const [hour, n] of counts) {
        const share = n / done.length;
        if (share >= 0.2 && n >= 3) out.push({ space, hour, share: round2(share), n });
      }
    } else {
      // Not enough history: use what the user told us.
      const periods = (space === 'study' ? answers.focus_study : answers.focus_work) ?? [];
      for (const p of periods) out.push({ space, hour: PERIODS[p][0], share: 0, n: 0 });
    }
  }
  return out.sort((a, b) => b.share - a.share || a.hour - b.hour);
}

export function computeProfile(input: {
  tasks: readonly HabitTask[];
  labels: Record<string, string>;
  answers: HabitAnswers;
  tz: string;
  now: number;
}): HabitProfile {
  return {
    estimates: estimateStats(input.tasks, input.labels, input.answers, input.now),
    focus: focusWindows(input.tasks, input.tz, input.now, input.answers),
    completedSample: input.tasks.filter((t) => t.status === 'done').length,
    computedAt: input.now,
  };
}

/** Multiplier for planning a task: its subject's ratio when trustworthy, else its space's. */
export function estimateFactor(profile: HabitProfile | null, task: { space: Space; collection_id: string | null }): number {
  if (!profile) return 1;
  const col = task.collection_id ? profile.estimates.find((e) => e.key === task.collection_id && e.confidence !== 'low') : undefined;
  const sp = profile.estimates.find((e) => e.key === task.space);
  const r = col?.ratio ?? sp?.ratio ?? 1;
  // Only stretch/shrink when the signal is meaningful (±10 %).
  return Math.abs(r - 1) < 0.1 ? 1 : r;
}

export function windowLabel(hour: number): string {
  const e = (hour + (hour >= 22 ? 4 : 2)) % 24;
  return `${String(hour % 24).padStart(2, '0')}:00–${String(e).padStart(2, '0')}:00`;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Subject/project nicknames found as whole words in the text, e.g. "mmt" → Mạng máy tính. */
export function aliasMatch(text: string, vocab: readonly VocabEntry[]): VocabEntry | null {
  const words = ` ${normalizeVi(text).replace(/[^a-z0-9]+/g, ' ')} `;
  let best: VocabEntry | null = null;
  for (const v of vocab) {
    if (!v.collection_id) continue;
    const key = normalizeVi(v.short)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (key && words.includes(` ${key} `) && (!best || key.length > best.short.length)) best = v;
  }
  return best;
}

/** Suggest a nickname from a correction: the short, unusual word the user's choice explains. */
export function aliasCandidate(input: string, collectionName: string): string | null {
  const name = normalizeVi(collectionName);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
  for (const raw of input.split(/[\s,.;:!?()]+/)) {
    const w = normalizeVi(raw);
    if (w.length >= 2 && w.length <= 6 && (w === initials || (name.startsWith(w) && w.length >= 3))) return raw.toLowerCase();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt summary
// ---------------------------------------------------------------------------

const MAX_VOCAB = 40;
const MAX_CORRECTIONS = 8;

export function habitsPrompt(
  ctx: {
    profile: HabitProfile | null;
    vocab: readonly VocabEntry[];
    corrections: readonly Correction[];
    collectionName: (id: string) => string | null;
    privacy: boolean;
  },
  use: 'parse' | 'plan' | 'split' | 'notes',
): string {
  const lines: string[] = [];
  const p = ctx.profile;
  if (p && (use === 'plan' || use === 'split')) {
    for (const e of p.estimates.filter((x) => x.confidence !== 'low' && Math.abs(x.ratio - 1) >= 0.1))
      lines.push(`- ${e.label}: actually takes ${e.ratio}× the estimate (${e.n} finished tasks).`);
  }
  if (p && use === 'plan') {
    for (const space of ['study', 'work'] as const) {
      const w = p.focus.filter((f) => f.space === space).slice(0, 3);
      if (w.length)
        lines.push(
          `- Prefers ${space === 'study' ? 'Học tập' : 'Công việc'} in: ${w.map((f) => windowLabel(f.hour)).join(', ')}. Prefer these when the rules allow.`,
        );
    }
  }
  if (use === 'parse' || use === 'notes' || use === 'split') {
    const vocab = ctx.vocab.slice(0, MAX_VOCAB);
    if (vocab.length) {
      lines.push('- This user writes:');
      for (const v of vocab) {
        const col = v.collection_id ? ctx.collectionName(v.collection_id) : null;
        lines.push(`  "${v.short}" = ${col ? `${col} (subject/project)` : v.meaning}`);
      }
    }
  }
  // Correction examples contain the user's own Quick Add text: not in privacy mode.
  if (use === 'parse' && !ctx.privacy) {
    const ex = ctx.corrections.slice(0, MAX_CORRECTIONS);
    if (ex.length) {
      lines.push('- Past corrections by the user (follow them):');
      for (const c of ex) lines.push(`  "${c.input_text.slice(0, 120)}" → ${c.field} should be ${c.user_value ?? 'empty'}`);
    }
  }
  if (lines.length === 0) return '';
  return ['', 'About this user (learned by Nhịp from their own use; rules above still win):', ...lines].join('\n');
}
