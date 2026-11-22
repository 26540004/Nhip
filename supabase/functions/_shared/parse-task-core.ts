/**
 * parse-task core (pure; shared by the Edge Function and Jest).
 * The AI segments Vietnamese text into tasks and quotes the phrases it used; deterministic
 * code resolves dates, durations, collections and space.
 */
import { z } from 'zod';
import { guessSpace, matchCollection, parseDurationMinutes, resolveDeadline } from './vi-parse.ts';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ParseTaskRequest = z.object({
  text: z.string().trim().min(1).max(1000),
  /** Client clock, ISO. The server uses its own clock; this is only for diagnostics. */
  client_now: z.string().optional(),
});
export type ParseTaskRequest = z.infer<typeof ParseTaskRequest>;

const nullableString = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const AiParsedTask = z.object({
  title: z.string().trim().min(1).max(300),
  space: z.enum(['study', 'work']),
  space_confident: z.boolean().optional().default(true),
  collection_name: nullableString(120),
  deadline_phrase: nullableString(200),
  deadline_at: nullableString(40),
  estimate_phrase: nullableString(100),
  estimate_minutes: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  priority: z.number().int().min(1).max(3),
  priority_reason: z.string().trim().max(200).default(''),
  subtasks: z
    .array(z.object({ title: z.string().trim().min(1).max(200), estimate_minutes: z.number().int().min(5).max(600) }))
    .max(8)
    .optional()
    .default([]),
});
export type AiParsedTask = z.infer<typeof AiParsedTask>;

export const AiParseResponse = z.object({ tasks: z.array(AiParsedTask).min(1).max(10) });
export type AiParseResponse = z.infer<typeof AiParseResponse>;

export interface CollectionRef {
  id: string;
  name: string;
  space: 'study' | 'work';
}

export interface ParsedTask {
  title: string;
  space: 'study' | 'work';
  /** UI highlights the space chip and asks the user to confirm. */
  space_uncertain: boolean;
  collection_id: string | null;
  collection_name: string | null;
  deadline_at: string | null;
  estimate_minutes: number | null;
  priority: 1 | 2 | 3;
  priority_reason: string;
  subtasks: { title: string; estimate_minutes: number }[];
}

export interface ParseTaskResponse {
  tasks: ParsedTask[];
  /** First URL found in the text → becomes a link attachment on the new task(s). */
  url: string | null;
  provider: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface PromptContext {
  text: string;
  nowIso: string;
  weekdayVi: string;
  tz: string;
  collections: readonly CollectionRef[];
  officeHoursSummary: string;
  /** Habit summary (vocabulary, past corrections). */
  habitsText?: string;
}

export function buildPrompt(ctx: PromptContext): { system: string; user: string } {
  const system =
    [
      'You extract to-do tasks from short Vietnamese notes for a personal planner. Output ONLY JSON.',
      'Schema: {"tasks":[{"title":string,"space":"study"|"work","space_confident":boolean,"collection_name":string|null,',
      '"deadline_phrase":string|null,"deadline_at":string|null,"estimate_phrase":string|null,"estimate_minutes":number|null,',
      '"priority":1|2|3,"priority_reason":string,"subtasks":[{"title":string,"estimate_minutes":number}]}]}',
      'Rules:',
      '- One sentence may contain several tasks (split on commas, "và", ";" when they are separate actions). Max 10.',
      '- title: short Vietnamese imperative, WITHOUT the date/time/duration words, keep subject/client names. Capitalize first letter.',
      '- deadline_phrase: copy EXACTLY the words from the input that express when (e.g. "thứ 6", "mai", "thứ 4 2h chiều", "trước 5h chiều", "tối nay"). null if none. Include the time words for that task only.',
      '- deadline_at: your best ISO 8601 with offset for that phrase (code will recompute it), or null.',
      '- estimate_phrase: copy EXACTLY the words expressing how long it takes ("khoảng 3 tiếng", "45 phút"); null if none. estimate_minutes: your number or null.',
      '- space: "study" for coursework (môn, bài tập, thi, đồ án, bài giảng, subjects listed below with space study); "work" for office tasks (họp, khách hàng, sếp, báo cáo công việc, projects with space work). space_confident=false when unsure.',
      '- collection_name: the matching name from the list below, or null. Never invent one.',
      '- priority: 1 = cao (deadline ≤ 2 days, exams, important clients), 2 = vừa, 3 = thấp. priority_reason: ONE short Vietnamese sentence (≤ 12 words).',
      '- subtasks: only when the estimate is > 120 minutes: 2–5 concrete Vietnamese steps of 30–90 min each summing to the estimate. Otherwise [].',
      '- Never add tasks that are not in the input.',
    ].join('\n') + (ctx.habitsText ?? '');

  const cols =
    ctx.collections.length === 0
      ? '(none)'
      : ctx.collections.map((c) => `- ${c.name} [${c.space === 'study' ? 'study/subject' : 'work/project'}]`).join('\n');

  const user = [
    `Now: ${ctx.nowIso} (${ctx.weekdayVi}), timezone ${ctx.tz}.`,
    `Office hours: ${ctx.officeHoursSummary}.`,
    'Collections:',
    cols,
    '',
    'Input:',
    ctx.text,
  ].join('\n');
  return { system, user };
}

// ---------------------------------------------------------------------------
// Post-processing (deterministic)
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

export function extractUrl(text: string): { url: string | null; rest: string } {
  const m = URL_RE.exec(text);
  if (!m) return { url: null, rest: text };
  const url = m[0].replace(/[).,;]+$/, '');
  return { url, rest: (text.slice(0, m.index) + text.slice(m.index + url.length)).replace(/\s+/g, ' ').trim() };
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toLocaleUpperCase('vi') + s.slice(1) : s;
}

export function finalizeParse(
  ai: AiParseResponse,
  ctx: {
    text: string;
    now: number;
    tz: string;
    collections: readonly CollectionRef[];
    url: string | null;
    provider: string;
    /** Learned nickname → subject/project ("mmt" → Mạng máy tính); beats the AI's guess. */
    alias?: (text: string) => { collection_id: string | null } | null;
  },
): ParseTaskResponse {
  const tasks: ParsedTask[] = ai.tasks.map((t) => {
    // Deadline: deterministic from the quoted phrase; AI's ISO only as a sanity-checked fallback.
    let deadline: string | null = null;
    if (t.deadline_phrase) deadline = resolveDeadline(t.deadline_phrase, ctx.now, ctx.tz)?.iso ?? null;
    if (!deadline && t.deadline_at) {
      const ms = Date.parse(t.deadline_at);
      const twoYears = 2 * 366 * 86_400_000;
      if (Number.isFinite(ms) && ms > ctx.now - 86_400_000 && ms < ctx.now + twoYears) deadline = t.deadline_at;
    }

    let estimate = t.estimate_phrase ? parseDurationMinutes(t.estimate_phrase) : null;
    if (estimate == null) estimate = t.estimate_minutes;

    // Match against this task's own title (not the whole sentence) plus the AI's hint.
    const aliased = ctx.alias?.(t.title) ?? (ai.tasks.length === 1 ? ctx.alias?.(ctx.text) : null);
    const chosen =
      (aliased?.collection_id ? ctx.collections.find((c) => c.id === aliased.collection_id) : undefined) ??
      matchCollection(t.title, ctx.collections, t.collection_name);

    const keyword = guessSpace(t.title);
    let space = t.space;
    let uncertain = !t.space_confident;
    if (chosen) {
      space = chosen.space;
      uncertain = false;
    } else if (keyword && keyword !== t.space) {
      uncertain = true;
    }

    const subtasks = estimate != null && estimate > 120 ? t.subtasks.slice(0, 6) : [];

    return {
      title: capitalize(t.title.trim()),
      space,
      space_uncertain: uncertain,
      collection_id: chosen?.id ?? null,
      collection_name: chosen?.name ?? null,
      deadline_at: deadline,
      estimate_minutes: estimate,
      priority: t.priority as 1 | 2 | 3,
      priority_reason: t.priority_reason,
      subtasks,
    };
  });
  return { tasks, url: ctx.url, provider: ctx.provider };
}
