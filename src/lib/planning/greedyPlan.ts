/**
 * greedyPlan — deterministic planner. Used when AI is unavailable, for "Cân bằng lại",
 * and as a baseline in tests. Its output always passes validatePlan unchanged because
 * both use PlacementEngine.checkPlacement.
 *
 * Strategy: rank tasks (priority + deadline), split long tasks into 45–90 min chunks,
 * place each chunk at the earliest valid slot, aiming to finish ≥ 1 day before the
 * deadline and spreading chunks of a long task across different days when possible.
 */
import { DAY, type Instant, dateKeyOf } from '../time/tz';
import { type EngineInput, type PlanTask, PlacementEngine } from './engine';
import { rankTasks } from './priority';
import type { ProposedBlock } from './validatePlan';

/** Split minutes into chunks ≤ max, each ≥ 45 where possible, rounded to 15. */
export function splitMinutes(total: number, max = 90, min = 45, step = 15): number[] {
  if (total <= 0) return [];
  if (total <= max) return [total];
  const n = Math.ceil(total / max);
  const base = Math.max(min, Math.floor(total / n / step) * step);
  const chunks: number[] = [];
  let left = total;
  for (let i = 0; i < n && left > 0; i++) {
    const size = i === n - 1 ? left : Math.min(base, left);
    chunks.push(size);
    left -= size;
  }
  // Merge a tiny tail into the previous chunk if that stays ≤ max, otherwise rebalance.
  const last = chunks[chunks.length - 1]!;
  if (chunks.length > 1 && last < min) {
    const prev = chunks[chunks.length - 2]!;
    if (prev + last <= max) {
      chunks.splice(chunks.length - 2, 2, prev + last);
    } else {
      const moved = min - last;
      chunks[chunks.length - 2] = prev - moved;
      chunks[chunks.length - 1] = min;
    }
  }
  return chunks;
}

export interface GreedyPlanInput extends EngineInput {
  tasks: readonly PlanTask[];
}

export interface GreedyPlanResult {
  blocks: ProposedBlock[];
  /** Task ids that could not be fully placed. */
  unplaced: string[];
}

export function greedyPlan(input: GreedyPlanInput): GreedyPlanResult {
  const engine = new PlacementEngine(input);
  const now: Instant = input.ctx.now ?? input.ctx.range.start;
  const ranked = rankTasks(
    input.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      deadlineAt: t.deadlineAt,
      remainingMinutes: t.remainingMinutes,
      createdAt: t.createdAt ?? 0,
    })),
    now,
    engine.tz,
  );
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const blocks: ProposedBlock[] = [];
  const unplaced: string[] = [];

  for (const r of ranked) {
    const task = byId.get(r.id)!;
    const chunks = splitMinutes(
      task.remainingMinutes,
      engine.rules.maxBlockMinutes,
      Math.min(45, task.remainingMinutes),
      engine.rules.stepMinutes,
    );
    const spread = task.remainingMinutes > engine.rules.splitThresholdMinutes;
    const usedDays = new Set<string>();
    const soft = task.deadlineAt == null ? null : task.deadlineAt - DAY;
    let complete = true;

    for (const minutes of chunks) {
      const attempts: [Instant | null, boolean][] = [
        [soft != null && soft > now ? soft : task.deadlineAt, spread],
        [task.deadlineAt, spread],
        [task.deadlineAt, false],
      ];
      let slot = null;
      for (const [latest, avoid] of attempts) {
        slot = engine.findEarliest(task, minutes, latest, avoid ? usedDays : undefined);
        if (slot) break;
      }
      if (!slot) {
        complete = false;
        continue;
      }
      engine.place({ ...slot, space: task.space, taskId: task.id });
      usedDays.add(dateKeyOf(slot.start, engine.tz));
      blocks.push({ taskId: task.id, start: slot.start, end: slot.end, reason: r.reason });
    }
    if (!complete) unplaced.push(task.id);
  }
  return { blocks, unplaced };
}
