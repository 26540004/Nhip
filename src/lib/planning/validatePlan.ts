/**
 * validatePlan — deterministic check + repair of AI-proposed blocks (spec §I.2d/e).
 *
 * For every proposed block: verify it is inside its space's allowed window, does not
 * overlap busy/class/other blocks (with buffer), respects per-day capacity, is ≤ 90 min,
 * does not exceed the task's remaining minutes, ends before the deadline, and keeps
 * continuous focus ≤ 3 h. Invalid blocks are moved to the nearest valid slot when
 * possible, otherwise dropped with a warning. Deadline-fit and overload warnings are
 * computed here, never by the AI.
 */
import { vi } from '../../i18n/vi';
import { formatDayHeader, formatDurationLong } from '../time/format';
import { MINUTE, type Instant } from '../time/tz';
import { computeLoads, overloadedDays } from './capacity';
import { type EngineInput, type IssueCode, type PlanTask, PlacementEngine } from './engine';

export interface ProposedBlock {
  taskId: string;
  start: Instant;
  end: Instant;
  reason?: string;
}

export interface AcceptedBlock extends ProposedBlock {
  space: PlanTask['space'];
  /** True when the validator changed the time or length. */
  repaired: boolean;
  original?: { start: Instant; end: Instant };
  issues: IssueCode[];
}

export interface DroppedBlock {
  block: ProposedBlock;
  issues: IssueCode[];
}

export type PlanWarning =
  | { kind: 'cannot_fit'; taskId: string; shortfallMinutes: number; message: string }
  | { kind: 'partial'; taskId: string; unscheduledMinutes: number; message: string }
  | { kind: 'overload'; date: string; space: PlanTask['space']; overMinutes: number; message: string }
  | { kind: 'dropped'; taskId: string; message: string }
  | { kind: 'repaired'; taskId: string; message: string };

export interface ValidationReport {
  blocks: AcceptedBlock[];
  dropped: DroppedBlock[];
  warnings: PlanWarning[];
}

export interface ValidatePlanInput extends EngineInput {
  tasks: readonly PlanTask[];
  proposed: readonly ProposedBlock[];
}

export function validatePlan(input: ValidatePlanInput): ValidationReport {
  const engine = new PlacementEngine(input);
  const { rules } = engine;
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const blocks: AcceptedBlock[] = [];
  const dropped: DroppedBlock[] = [];
  const warnings: PlanWarning[] = [];

  const ordered = [...input.proposed].sort((a, b) => a.start - b.start);

  for (const p of ordered) {
    const task = tasks.get(p.taskId);
    if (!task) {
      dropped.push({ block: p, issues: ['unknown_task'] });
      continue;
    }
    if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end <= p.start) {
      dropped.push({ block: p, issues: ['invalid_range'] });
      warnings.push({ kind: 'dropped', taskId: task.id, message: vi.plan.warning.dropped(task.title) });
      continue;
    }

    const issues: IssueCode[] = [];
    let minutes = Math.round((p.end - p.start) / MINUTE);

    if (minutes > rules.maxBlockMinutes) {
      issues.push('too_long');
      minutes = rules.maxBlockMinutes;
    }

    const left = task.remainingMinutes - engine.scheduledMinutesFor(task.id);
    if (left <= 0) {
      dropped.push({ block: p, issues: ['exceeds_remaining'] });
      continue; // surplus block; not worth a warning
    }
    if (minutes > left) {
      issues.push('exceeds_remaining');
      minutes = left;
    }
    if (minutes < Math.min(rules.minBlockMinutes, left)) {
      dropped.push({ block: p, issues: [...issues, 'too_short'] });
      warnings.push({ kind: 'dropped', taskId: task.id, message: vi.plan.warning.dropped(task.title) });
      continue;
    }

    const candidate = { start: p.start, end: p.start + minutes * MINUTE };
    const placementIssues = engine.checkPlacement(task, candidate);

    if (placementIssues.length === 0) {
      engine.place({ ...candidate, space: task.space, taskId: task.id });
      const repaired = issues.length > 0;
      blocks.push({
        ...p,
        ...candidate,
        space: task.space,
        repaired,
        ...(repaired ? { original: { start: p.start, end: p.end } } : {}),
        issues,
      });
      continue;
    }

    const allIssues = [...issues, ...placementIssues];
    const fixed = engine.findNearest(task, minutes, p.start);
    if (fixed) {
      engine.place({ ...fixed, space: task.space, taskId: task.id });
      blocks.push({ ...p, ...fixed, space: task.space, repaired: true, original: { start: p.start, end: p.end }, issues: allIssues });
      warnings.push({ kind: 'repaired', taskId: task.id, message: vi.plan.warning.repaired(task.title) });
    } else {
      dropped.push({ block: p, issues: allIssues });
      warnings.push({ kind: 'dropped', taskId: task.id, message: vi.plan.warning.dropped(task.title) });
    }
  }

  warnings.push(...deadlineWarnings(engine, input));
  warnings.push(...overloadWarnings(engine, input));

  return { blocks, dropped, warnings };
}

/** Deterministic "cannot fit before deadline" and "partially scheduled" warnings. */
function deadlineWarnings(engine: PlacementEngine, input: ValidatePlanInput): PlanWarning[] {
  const out: PlanWarning[] = [];
  const from = Math.max(input.ctx.range.start, input.ctx.now ?? input.ctx.range.start);
  for (const task of input.tasks) {
    if (task.remainingMinutes <= 0) continue;
    const scheduled = engine.scheduledMinutesFor(task.id);
    const unscheduled = task.remainingMinutes - scheduled;
    if (unscheduled <= 0) continue;

    // Only judge "cannot fit" when the deadline lies inside the planning range;
    // otherwise later days (outside this plan) may still have room.
    if (task.deadlineAt != null && task.deadlineAt <= input.ctx.range.end) {
      const available = engine.availableBeforeDeadline(task, from);
      if (available < unscheduled) {
        out.push({
          kind: 'cannot_fit',
          taskId: task.id,
          shortfallMinutes: unscheduled - available,
          message: vi.plan.warning.cannotFit(task.title, formatDurationLong(unscheduled - available)),
        });
        continue;
      }
    }
    out.push({
      kind: 'partial',
      taskId: task.id,
      unscheduledMinutes: unscheduled,
      message: vi.plan.warning.partial(task.title, formatDurationLong(unscheduled)),
    });
  }
  return out;
}

function overloadWarnings(engine: PlacementEngine, input: ValidatePlanInput): PlanWarning[] {
  const loads = computeLoads(engine.allAppBlocks(), input.capacity, undefined, engine.tz);
  return overloadedDays(loads).map((l) => ({
    kind: 'overload' as const,
    date: l.date,
    space: l.space,
    overMinutes: l.overMinutes,
    message: vi.plan.warning.overload(formatDayHeader(l.date), vi.space[l.space], formatDurationLong(l.overMinutes)),
  }));
}
