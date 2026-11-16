/**
 * Placement engine shared by `validatePlan` (checks/repairs AI output) and `greedyPlan`
 * (deterministic fallback planner). Every placement decision in the app goes through
 * `checkPlacement`, so the two can never disagree about what is valid.
 */
import { type Interval, mergeIntervals, overlaps, pad, subtractIntervals } from '../time/intervals';
import { type SlotContext, type Space, allowedWindows, classOccurrences, quietIntervals } from '../time/slots';
import { APP_TZ, MINUTE, type Instant, dateKeyOf } from '../time/tz';
import { type CapacitySetting, type SpacedInterval, remainingCapacity, usageByDay } from './capacity';
import type { Priority } from './priority';

export interface PlanRules {
  maxBlockMinutes: number;
  minBlockMinutes: number;
  bufferMinutes: number;
  maxConsecutiveMinutes: number;
  /** Two blocks with a gap smaller than this count as one continuous focus stretch. */
  consecutiveGapMinutes: number;
  /** Candidate start times are aligned to this grid when searching for a slot. */
  stepMinutes: number;
  /** Split tasks longer than this across multiple blocks/days. */
  splitThresholdMinutes: number;
}

export const DEFAULT_RULES: PlanRules = {
  maxBlockMinutes: 90,
  minBlockMinutes: 15,
  bufferMinutes: 10,
  maxConsecutiveMinutes: 180,
  consecutiveGapMinutes: 30,
  stepMinutes: 15,
  splitThresholdMinutes: 120,
};

export interface PlanTask {
  id: string;
  title: string;
  space: Space;
  priority: Priority;
  deadlineAt: Instant | null;
  /** estimate − minutes already in accepted/synced blocks. */
  remainingMinutes: number;
  createdAt?: Instant;
}

export interface PlacedBlock extends SpacedInterval {
  taskId: string;
}

export type IssueCode =
  | 'unknown_task'
  | 'invalid_range'
  | 'too_long'
  | 'too_short'
  | 'outside_window'
  | 'overlap'
  | 'after_deadline'
  | 'exceeds_remaining'
  | 'over_capacity'
  | 'too_many_consecutive';

export interface EngineInput {
  /** Slot context. `busy` must contain Google busy times only — pass app blocks via `existingBlocks`. */
  ctx: SlotContext;
  capacity: readonly CapacitySetting[];
  /** Already accepted/synced app blocks (not part of this plan). */
  existingBlocks: readonly PlacedBlock[];
  rules?: Partial<PlanRules>;
}

export class PlacementEngine {
  readonly rules: PlanRules;
  readonly tz: string;
  private readonly allowed: Record<Space, Interval[]>;
  /** Quiet hours + past: forbidden, no buffer. */
  private readonly hardNoBuffer: Interval[];
  /** Classes + Google busy: forbidden with buffer. */
  private readonly hardBuffered: Interval[];
  private readonly existing: PlacedBlock[];
  private readonly placed: PlacedBlock[] = [];

  constructor(private readonly input: EngineInput) {
    this.rules = { ...DEFAULT_RULES, ...input.rules };
    this.tz = input.ctx.tz ?? APP_TZ;
    const ctx = input.ctx;
    this.allowed = { work: allowedWindows(ctx, 'work'), study: allowedWindows(ctx, 'study') };
    const past: Interval[] = ctx.now != null && ctx.now > ctx.range.start ? [{ start: ctx.range.start, end: ctx.now }] : [];
    this.hardNoBuffer = mergeIntervals([...quietIntervals(ctx), ...past]);
    this.hardBuffered = mergeIntervals([...classOccurrences(ctx), ...ctx.busy]);
    this.existing = [...input.existingBlocks];
  }

  get placedBlocks(): readonly PlacedBlock[] {
    return this.placed;
  }

  allAppBlocks(): PlacedBlock[] {
    return [...this.existing, ...this.placed];
  }

  place(block: PlacedBlock): void {
    this.placed.push(block);
  }

  scheduledMinutesFor(taskId: string): number {
    return this.placed.filter((b) => b.taskId === taskId).reduce((sum, b) => sum + Math.round((b.end - b.start) / MINUTE), 0);
  }

  /** Everything a new block must not intersect (buffers applied where they belong). */
  private forbidden(): Interval[] {
    const b = this.rules.bufferMinutes;
    return mergeIntervals([...this.hardNoBuffer, ...pad(this.hardBuffered, b), ...pad(this.allAppBlocks(), b)]);
  }

  /** Placement issues for a candidate, ignoring task-level limits (remaining minutes). */
  checkPlacement(task: PlanTask, iv: Interval): IssueCode[] {
    const issues: IssueCode[] = [];
    const minutes = Math.round((iv.end - iv.start) / MINUTE);
    if (!(iv.end > iv.start)) return ['invalid_range'];
    if (minutes > this.rules.maxBlockMinutes) issues.push('too_long');

    const inWindow = this.allowed[task.space].some((w) => w.start <= iv.start && iv.end <= w.end);
    if (!inWindow) issues.push('outside_window');

    if (this.forbidden().some((f) => overlaps(f, iv))) issues.push('overlap');

    if (task.deadlineAt != null && iv.end > task.deadlineAt) issues.push('after_deadline');

    if (!this.fitsCapacity(task.space, iv)) issues.push('over_capacity');

    if (!this.fitsConsecutive(iv)) issues.push('too_many_consecutive');
    return issues;
  }

  private fitsCapacity(space: Space, iv: Interval): boolean {
    const usage = usageByDay(this.allAppBlocks(), this.tz);
    const add = usageByDay([{ ...iv, space }], this.tz);
    for (const [day, u] of add) {
      if (u[space] > remainingCapacity(day, space, usage, this.input.capacity)) return false;
    }
    return true;
  }

  private fitsConsecutive(iv: Interval): boolean {
    const gap = this.rules.consecutiveGapMinutes * MINUTE;
    const all: Interval[] = [...this.allAppBlocks(), iv].sort((a, b) => a.start - b.start);
    let chainMinutes = 0;
    let chainHasCandidate = false;
    let prevEnd = Number.NEGATIVE_INFINITY;
    for (const cur of all) {
      if (cur.start - prevEnd >= gap) {
        if (chainHasCandidate) break; // candidate's chain is complete
        chainMinutes = 0;
      }
      chainMinutes += Math.round((cur.end - cur.start) / MINUTE);
      if (cur === iv) chainHasCandidate = true;
      prevEnd = Math.max(prevEnd, cur.end);
    }
    return !(chainHasCandidate && chainMinutes > this.rules.maxConsecutiveMinutes);
  }

  /** Free intervals for a space right now (allowed − forbidden). */
  freeFor(space: Space): Interval[] {
    return subtractIntervals(this.allowed[space], this.forbidden());
  }

  /** Candidate starts for a block of `minutes` within free time, ending by `latestEnd`. */
  candidates(space: Space, minutes: number, latestEnd: Instant | null): Interval[] {
    const dur = minutes * MINUTE;
    const step = this.rules.stepMinutes * MINUTE;
    const out: Interval[] = [];
    for (const f of this.freeFor(space)) {
      const limit = latestEnd == null ? f.end : Math.min(f.end, latestEnd);
      if (limit - f.start < dur) continue;
      // Align to the local step grid (+07:00 is whole hours, so UTC alignment == local alignment for 15 min).
      let s = Math.ceil(f.start / step) * step;
      if (s + dur > limit) s = f.start; // tiny window: use its exact start
      const seen = new Set<number>();
      for (; s + dur <= limit; s += step) {
        out.push({ start: s, end: s + dur });
        seen.add(s);
      }
      const tail = limit - dur;
      if (tail >= f.start && !seen.has(tail)) out.push({ start: tail, end: limit });
    }
    return out;
  }

  /** Nearest valid slot to `around` for the task, or null. */
  findNearest(task: PlanTask, minutes: number, around: Instant): Interval | null {
    const cands = this.candidates(task.space, minutes, task.deadlineAt).sort(
      (a, b) => Math.abs(a.start - around) - Math.abs(b.start - around) || a.start - b.start,
    );
    for (const c of cands) if (this.checkPlacement(task, c).length === 0) return c;
    return null;
  }

  /** Earliest valid slot ending by `latestEnd`, optionally avoiding given local days. */
  findEarliest(task: PlanTask, minutes: number, latestEnd: Instant | null, avoidDays?: ReadonlySet<string>): Interval | null {
    const cands = this.candidates(task.space, minutes, latestEnd).sort((a, b) => a.start - b.start);
    for (const c of cands) {
      if (avoidDays && avoidDays.has(dateKeyOf(c.start, this.tz))) continue;
      if (this.checkPlacement(task, c).length === 0) return c;
    }
    return null;
  }

  /** Max minutes this task could still get before its deadline (free time ∩ capacity), ignoring other plan tasks. */
  availableBeforeDeadline(task: PlanTask, from: Instant): number {
    if (task.deadlineAt == null) return Number.POSITIVE_INFINITY;
    const window: Interval = { start: from, end: task.deadlineAt };
    const free = this.freeFor(task.space)
      .filter((f) => overlaps(f, window))
      .map((f) => ({
        start: Math.max(f.start, window.start),
        end: Math.min(f.end, window.end),
        space: task.space,
      }));
    const freeByDay = usageByDay(free, this.tz);
    const usage = usageByDay(this.allAppBlocks(), this.tz);
    let total = 0;
    for (const [day, u] of freeByDay) {
      total += Math.min(u[task.space], remainingCapacity(day, task.space, usage, this.input.capacity));
    }
    return total;
  }
}
