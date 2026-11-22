/**
 * propose-plan core (pure; shared by the Edge Function and Jest).
 *
 * Hybrid design (spec §I.2): code builds the context and computes free slots; the AI only
 * proposes blocks inside those slots; code validates/repairs every block (validatePlan),
 * tops up unplaced minutes deterministically, and computes all warnings. If the AI is
 * unavailable the deterministic greedy planner produces the whole proposal.
 */
import { z } from 'zod';
import type { CapacitySetting } from './planning/capacity.ts';
import { type PlacedBlock, type PlanTask, PlacementEngine } from './planning/engine.ts';
import { greedyPlan } from './planning/greedyPlan.ts';
import type { Interval } from './planning/intervals.ts';
import { rankTasks } from './planning/priority.ts';
import { type QuietHours, type SlotContext, type Space } from './planning/slots.ts';
import { viCore } from './planning/strings.ts';
import { addDaysToKey, dateKeyOf, hhmmOf, localToInstant, MINUTE, type Instant } from './planning/tz.ts';
import { type AcceptedBlock, type PlanWarning, type ProposedBlock, validatePlan } from './planning/validatePlan.ts';

// ---------------------------------------------------------------------------
// Request / AI schemas
// ---------------------------------------------------------------------------

export const ProposePlanRequest = z.object({
  range: z.enum(['today', 'tomorrow', 'week']).default('today'),
  /** Plan only these tasks ("✦ Xếp lịch việc này"). */
  task_ids: z.array(z.string().uuid()).max(50).optional(),
  /** "Cân bằng lại" for an overloaded local date (YYYY-MM-DD). */
  rebalance_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ProposePlanRequest = z.infer<typeof ProposePlanRequest>;

export const AiPlanResponse = z.object({
  summary: z.string().max(400).default(''),
  blocks: z
    .array(
      z.object({
        task: z.string().max(10),
        start: z.string().max(40),
        end: z.string().max(40),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(60),
});
export type AiPlanResponse = z.infer<typeof AiPlanResponse>;

// ---------------------------------------------------------------------------
// Inputs from the database
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  parent_task_id: string | null;
  title: string;
  space: Space;
  deadline_at: string | null;
  estimate_minutes: number | null;
  priority: 1 | 2 | 3;
  status: string;
  created_at: string;
  collection_id?: string | null;
}

export interface BlockRow {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: string;
}

export interface PlanInputs {
  now: Instant;
  tz: string;
  request: ProposePlanRequest;
  tasks: TaskRow[];
  /** accepted / synced / conflict blocks */
  blocks: BlockRow[];
  busy: Interval[];
  /** Habit profile: how much longer this user's tasks really take (1 = as estimated). */
  estimateFactor?: (t: TaskRow) => number;
  /** Habit summary appended to the AI prompt. */
  habitsText?: string;
  rules: {
    workHours: SlotContext['workHours'];
    studyWindows: SlotContext['studyWindows'];
    classSessions: SlotContext['classSessions'];
    exceptions: SlotContext['exceptions'];
    quietHours: QuietHours | null;
  };
  capacity: CapacitySetting[];
  privacyMode: boolean;
}

/** Tasks without an estimate are planned as 60 minutes. */
export const DEFAULT_ESTIMATE = 60;

export interface PlanContext {
  ctx: SlotContext;
  tasks: PlanTask[];
  existing: PlacedBlock[];
  /** Blocks released by "Cân bằng lại" — replaced when the proposal is applied. */
  replaces: string[];
  alias: Map<string, string>; // T1 → task id
  aliasOf: Map<string, string>; // task id → T1
  /** Priority order with one-line reasons, computed with the ORIGINAL deadlines (overdue first). */
  ranking: { id: string; reason: string }[];
}

export function planRange(req: ProposePlanRequest, now: Instant, tz: string): Interval {
  const today = dateKeyOf(now, tz);
  if (req.rebalance_date) {
    const start = Math.max(now, localToInstant(req.rebalance_date, 0, tz));
    return { start, end: localToInstant(addDaysToKey(req.rebalance_date, 7), 0, tz) };
  }
  if (req.range === 'tomorrow') {
    const t = addDaysToKey(today, 1);
    return { start: Math.max(now, localToInstant(t, 0, tz)), end: localToInstant(addDaysToKey(t, 1), 0, tz) };
  }
  if (req.range === 'week' || (req.task_ids && req.task_ids.length > 0)) {
    return { start: now, end: localToInstant(addDaysToKey(today, 8), 0, tz) };
  }
  return { start: now, end: localToInstant(addDaysToKey(today, 1), 0, tz) };
}

export function buildPlanContext(input: PlanInputs, maxTasks = 25): PlanContext {
  const { now, tz, request } = input;
  const range = planRange(request, now, tz);

  // "Cân bằng lại": release the day's movable blocks so they can be re-planned.
  const replaces: string[] = [];
  let blocks = input.blocks;
  if (request.rebalance_date) {
    const d0 = localToInstant(request.rebalance_date, 0, tz);
    const d1 = localToInstant(request.rebalance_date, 1440, tz);
    for (const b of input.blocks) {
      const s = Date.parse(b.start_at);
      if (s >= Math.max(d0, now) && s < d1) replaces.push(b.id);
    }
    const released = new Set(replaces);
    blocks = input.blocks.filter((b) => !released.has(b.id));
  }

  const open = input.tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const hasOpenChildren = new Set(open.filter((t) => t.parent_task_id).map((t) => t.parent_task_id!));

  const scheduled = new Map<string, number>();
  for (const b of blocks)
    scheduled.set(b.task_id, (scheduled.get(b.task_id) ?? 0) + (Date.parse(b.end_at) - Date.parse(b.start_at)) / MINUTE);

  const releasedTaskIds = new Set(input.blocks.filter((b) => replaces.includes(b.id)).map((b) => b.task_id));
  const wanted = request.task_ids?.length ? new Set(request.task_ids) : null;

  const candidates: PlanTask[] = [];
  const originalDeadline = new Map<string, number | null>();
  for (const t of open) {
    if (hasOpenChildren.has(t.id)) continue; // plan the subtasks instead
    const parent = t.parent_task_id ? byId.get(t.parent_task_id) : undefined;
    if (wanted && !wanted.has(t.id) && !(parent && wanted.has(parent.id))) continue;
    if (request.rebalance_date && !releasedTaskIds.has(t.id)) continue;
    const deadlineIso = t.deadline_at ?? parent?.deadline_at ?? null;
    const deadline = deadlineIso ? Date.parse(deadlineIso) : null;
    // Learned overrun: a user whose study tasks take 1.4× gets 1.4× the time planned.
    const factor = t.estimate_minutes != null ? (input.estimateFactor?.(t) ?? 1) : 1;
    const remaining = Math.round(((t.estimate_minutes ?? DEFAULT_ESTIMATE) * factor) / 5) * 5 - Math.round(scheduled.get(t.id) ?? 0);
    if (remaining <= 0) continue;
    originalDeadline.set(t.id, deadline);
    candidates.push({
      id: t.id,
      title: parent ? `${parent.title} › ${t.title}` : t.title,
      space: t.space,
      priority: t.priority,
      // Overdue tasks are planned as soon as possible instead of being impossible.
      deadlineAt: deadline != null && deadline > now ? deadline : null,
      remainingMinutes: remaining,
      createdAt: Date.parse(t.created_at),
    });
  }

  // Keep the most urgent ones; skip tasks due far beyond the range unless explicitly requested.
  const horizon = range.end + 21 * 86_400_000;
  const relevant =
    wanted || request.rebalance_date ? candidates : candidates.filter((t) => t.deadlineAt == null || t.deadlineAt <= horizon);
  const ranked = rankTasks(
    relevant.map((t) => ({ ...t, deadlineAt: originalDeadline.get(t.id) ?? null, createdAt: t.createdAt ?? 0 })),
    now,
    tz,
  );
  const chosenIds = new Set(ranked.slice(0, maxTasks).map((r) => r.id));
  const tasks = relevant.filter((t) => chosenIds.has(t.id));

  const alias = new Map<string, string>();
  const aliasOf = new Map<string, string>();
  ranked
    .filter((r) => chosenIds.has(r.id))
    .forEach((r, i) => {
      alias.set(`T${i + 1}`, r.id);
      aliasOf.set(r.id, `T${i + 1}`);
    });

  const taskSpace = new Map(input.tasks.map((t) => [t.id, t.space]));
  const existing: PlacedBlock[] = blocks.map((b) => ({
    taskId: b.task_id,
    space: taskSpace.get(b.task_id) ?? 'work',
    start: Date.parse(b.start_at),
    end: Date.parse(b.end_at),
  }));

  const ctx: SlotContext = {
    tz,
    range,
    now,
    workHours: input.rules.workHours,
    studyWindows: input.rules.studyWindows,
    classSessions: input.rules.classSessions,
    exceptions: input.rules.exceptions,
    busy: input.busy,
    quietHours: input.rules.quietHours,
  };
  const ranking = ranked.filter((r) => chosenIds.has(r.id)).map((r) => ({ id: r.id, reason: r.reason }));
  return { ctx, tasks, existing, replaces, alias, aliasOf, ranking };
}

// ---------------------------------------------------------------------------
// Prompt (compact JSON: tasks + candidate free slots, never raw calendars or notes)
// ---------------------------------------------------------------------------

const localStr = (t: Instant, tz: string) => `${dateKeyOf(t, tz)}T${hhmmOf(t, tz)}`;

export function buildPlanPrompt(
  pc: PlanContext,
  input: Pick<PlanInputs, 'capacity' | 'privacyMode' | 'habitsText'>,
): { system: string; user: string } {
  const engine = new PlacementEngine({ ctx: pc.ctx, capacity: input.capacity, existingBlocks: pc.existing });
  const tz = pc.ctx.tz!;
  const slots = (space: Space) =>
    engine
      .freeFor(space)
      .filter((i) => i.end - i.start >= 15 * MINUTE)
      .slice(0, 60)
      .map((i) => [localStr(i.start, tz), localStr(i.end, tz)]);

  const payload = {
    now: localStr(pc.ctx.now ?? pc.ctx.range.start, tz),
    tasks: pc.tasks.map((t) => ({
      id: pc.aliasOf.get(t.id),
      title: input.privacyMode ? t.title.slice(0, 60) : t.title.slice(0, 120),
      space: t.space,
      priority: t.priority,
      deadline: t.deadlineAt != null ? localStr(t.deadlineAt, tz) : null,
      minutes: t.remainingMinutes,
    })),
    free_slots: { work: slots('work'), study: slots('study') },
  };

  const system = [
    'You are a scheduling assistant for a Vietnamese student who also works. Output ONLY JSON:',
    '{"summary": string, "blocks": [{"task": "T1", "start": "YYYY-MM-DDTHH:mm", "end": "YYYY-MM-DDTHH:mm", "reason": string}]}',
    'Rules (code re-validates every block; invalid blocks are moved or dropped):',
    "- Place blocks ONLY inside free_slots of the task's own space (work tasks in work slots, study tasks in study slots). Times are local.",
    '- Aim to finish each task at least 1 day before its deadline when possible.',
    '- Tasks over 120 minutes: split into 45–90 minute blocks across several days. Never exceed 90 minutes per block.',
    '- Leave at least 10 minutes between blocks; at most 3 hours of consecutive focus.',
    '- Do not schedule more than a task\'s "minutes".',
    '- Higher priority (1) and nearer deadlines get earlier, better slots; heavy work tasks prefer mornings.',
    '- reason: ONE short Vietnamese sentence (≤ 12 words) explaining why this slot (e.g. "Hạn thứ 6, ưu tiên cao, buổi sáng còn trống").',
    '- summary: 1–2 short Vietnamese sentences describing the plan (e.g. "Tuần này có 3 deadline. Mình chia báo cáo Mạng thành 3 buổi tối.").',
  ].join('\n');
  return { system: system + (input.habitsText ?? ''), user: JSON.stringify(payload) };
}

// ---------------------------------------------------------------------------
// Finalize: map, validate, top up, warn
// ---------------------------------------------------------------------------

function parseLocal(s: string, tz: string): Instant | null {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s);
  if (!m) return null;
  try {
    return localToInstant(m[1]!, m[2]!, tz);
  } catch {
    return null;
  }
}

export interface PlanOutcome {
  blocks: AcceptedBlock[];
  warnings: PlanWarning[];
  summary: string;
  source: 'ai' | 'fallback';
  stats: { proposed: number; repaired: number; dropped: number; toppedUp: number };
}

export function finalizePlan(pc: PlanContext, ai: AiPlanResponse | null, capacity: CapacitySetting[]): PlanOutcome {
  const tz = pc.ctx.tz!;
  const engineInput = { ctx: pc.ctx, capacity, existingBlocks: pc.existing };
  let proposed: ProposedBlock[];
  if (ai) {
    proposed = [];
    for (const b of ai.blocks) {
      const taskId = pc.alias.get(b.task.trim());
      const start = parseLocal(b.start, tz);
      const end = parseLocal(b.end, tz);
      if (!taskId || start == null || end == null) continue;
      proposed.push({ taskId, start, end, reason: b.reason || undefined });
    }
  } else {
    proposed = greedyPlan({ ...engineInput, tasks: pc.tasks, ranking: pc.ranking }).blocks.map((b) => ({
      ...b,
      reason: viCore.plan.reasonGreedy(b.reason ?? ''),
    }));
  }

  const first = validatePlan({ ...engineInput, tasks: pc.tasks, proposed });

  // Top up: anything the AI left unplaced that still fits gets a deterministic slot.
  let toppedUp = 0;
  let blocks = first.blocks;
  if (ai) {
    const placedByTask = new Map<string, number>();
    for (const b of blocks) placedByTask.set(b.taskId, (placedByTask.get(b.taskId) ?? 0) + (b.end - b.start) / MINUTE);
    const leftover = pc.tasks
      .map((t) => ({ ...t, remainingMinutes: t.remainingMinutes - (placedByTask.get(t.id) ?? 0) }))
      .filter((t) => t.remainingMinutes >= 15);
    if (leftover.length) {
      const extra = greedyPlan({
        ...engineInput,
        existingBlocks: [...pc.existing, ...blocks.map((b) => ({ taskId: b.taskId, space: b.space, start: b.start, end: b.end }))],
        tasks: leftover,
        ranking: pc.ranking.filter((r) => leftover.some((t) => t.id === r.id)),
      }).blocks;
      toppedUp = extra.length;
      blocks = [
        ...blocks,
        ...extra.map((b) => ({
          ...b,
          space: pc.tasks.find((t) => t.id === b.taskId)!.space,
          repaired: false,
          issues: [],
          reason: viCore.plan.reasonTopUp,
        })),
      ];
    }
  }

  // Final, authoritative validation of the complete set (also recomputes warnings).
  const final = validatePlan({ ...engineInput, tasks: pc.tasks, proposed: blocks });
  // Deadline/overload warnings from the final set; repair/drop notes from the AI pass.
  const warnings: PlanWarning[] = [
    ...final.warnings.filter((w) => w.kind !== 'repaired' && w.kind !== 'dropped'),
    ...first.warnings.filter((w) => w.kind === 'repaired' || w.kind === 'dropped'),
  ];
  const taskCount = new Set(final.blocks.map((b) => b.taskId)).size;
  const summary = ai?.summary?.trim() ? ai.summary.trim() : viCore.plan.summaryFallback(final.blocks.length, taskCount);
  return {
    blocks: final.blocks.sort((a, b) => a.start - b.start),
    warnings,
    summary,
    source: ai ? 'ai' : 'fallback',
    stats: {
      proposed: proposed.length,
      repaired: first.blocks.filter((b) => b.repaired).length,
      dropped: first.dropped.length,
      toppedUp,
    },
  };
}
