/**
 * Validation for manual block moves (drag on the calendar, "Đổi giờ", "Sửa giờ" on a
 * proposal). Uses the same PlacementEngine as the server, so a move the app accepts is a
 * move propose-plan would also accept.
 */
import type { CapacitySetting } from '../../../supabase/functions/_shared/planning/capacity.ts';
import { type IssueCode, type PlacedBlock, type PlanTask, PlacementEngine } from '../../../supabase/functions/_shared/planning/engine.ts';
import type { Interval } from '../../../supabase/functions/_shared/planning/intervals.ts';
import type { SlotContext } from '../../../supabase/functions/_shared/planning/slots.ts';
import { MINUTE } from '../../../supabase/functions/_shared/planning/tz.ts';

export interface MoveContext {
  ctx: SlotContext;
  capacity: readonly CapacitySetting[];
  /** Every other block that occupies time (the moved block must be excluded). */
  others: readonly PlacedBlock[];
}

/** Issues that make a move invalid. 'after_deadline' is reported but allowed (user's call). */
export const BLOCKING: readonly IssueCode[] = [
  'invalid_range',
  'too_long',
  'outside_window',
  'overlap',
  'over_capacity',
  'too_many_consecutive',
];

export function checkMove(mc: MoveContext, task: PlanTask, iv: Interval): { ok: boolean; issues: IssueCode[] } {
  const engine = new PlacementEngine({ ctx: mc.ctx, capacity: mc.capacity, existingBlocks: mc.others });
  const issues = engine.checkPlacement(task, iv);
  return { ok: !issues.some((i) => BLOCKING.includes(i)), issues };
}

/** Valid start options for a block of `minutes` within [from, to), earliest first. */
export function slotOptions(mc: MoveContext, task: PlanTask, minutes: number, window: Interval, max = 24): Interval[] {
  const engine = new PlacementEngine({ ctx: { ...mc.ctx, range: window }, capacity: mc.capacity, existingBlocks: mc.others });
  const out: Interval[] = [];
  const free = { ...task, deadlineAt: null }; // let the user go past the deadline knowingly
  for (const c of engine.candidates(task.space, minutes, null)) {
    if (c.start < window.start || c.end > window.end) continue;
    if (c.start % (15 * MINUTE) !== 0) continue; // only round times in the picker
    if (engine.checkPlacement(free, c).length === 0) out.push(c);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.start - b.start);
}
