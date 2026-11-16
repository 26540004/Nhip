/**
 * Local "start of block" reminder scheduler (pure). iOS allows at most 64 pending local
 * notifications per app, so we keep only the nearest `limit` (default 50) and diff
 * against what is already scheduled. The expo-notifications adapter applies the diff.
 */
import { vi } from '../../i18n/vi';
import type { QuietHours } from '../time/slots';
import { formatTimeRange } from '../time/format';
import { APP_TZ, MINUTE, type Instant, dateKeyOf, hhmmToMinutes, localToInstant, addDaysToKey } from '../time/tz';

export const IOS_PENDING_LIMIT = 64;
export const DEFAULT_LOCAL_LIMIT = 50;

export interface ReminderBlock {
  id: string;
  taskId: string;
  title: string;
  start: Instant;
  end: Instant;
  status: 'proposed' | 'accepted' | 'synced' | 'rejected' | 'conflict';
  /** Task already done → no reminder. */
  taskDone?: boolean;
}

export interface LocalReminder {
  /** Stable identifier: `block:<blockId>:<startMs>` so a moved block gets a new id. */
  id: string;
  fireAt: Instant;
  title: string;
  body: string;
  data: { blockId: string; taskId: string; url: string };
}

export interface ReminderOptions {
  now: Instant;
  offsetMinutes: number;
  quietHours?: QuietHours | null;
  limit?: number;
  tz?: string;
}

export function reminderId(block: Pick<ReminderBlock, 'id' | 'start'>): string {
  return `block:${block.id}:${block.start}`;
}

/** If `t` is inside quiet hours, return the instant quiet hours end; else null. */
export function quietEndIfInside(t: Instant, quiet: QuietHours, tz: string): Instant | null {
  const day = dateKeyOf(t, tz);
  const s = hhmmToMinutes(quiet.start);
  let e = hhmmToMinutes(quiet.end);
  if (e <= s) e += 1440;
  for (const key of [addDaysToKey(day, -1), day]) {
    const qs = localToInstant(key, s, tz);
    const qe = localToInstant(key, e, tz);
    if (t >= qs && t < qe) return qe;
  }
  return null;
}

export function desiredReminders(blocks: readonly ReminderBlock[], opts: ReminderOptions): LocalReminder[] {
  const tz = opts.tz ?? APP_TZ;
  const limit = Math.min(opts.limit ?? DEFAULT_LOCAL_LIMIT, IOS_PENDING_LIMIT);
  const out: LocalReminder[] = [];
  for (const b of blocks) {
    if (b.taskDone) continue;
    if (b.status !== 'accepted' && b.status !== 'synced') continue;
    if (b.start <= opts.now) continue;

    let fireAt = b.start - opts.offsetMinutes * MINUTE;
    if (opts.quietHours) {
      const qe = quietEndIfInside(fireAt, opts.quietHours, tz);
      if (qe != null) fireAt = Math.min(qe, b.start);
    }
    if (fireAt <= opts.now) {
      // Offset already passed but block hasn't started: remind right away is noisy;
      // only remind if at least 1 minute remains.
      if (b.start - opts.now < MINUTE) continue;
      fireAt = opts.now + 5_000;
    }
    const minutesBefore = Math.max(0, Math.round((b.start - fireAt) / MINUTE));
    out.push({
      id: reminderId(b),
      fireAt,
      title: vi.notifications.blockStartTitle(b.title),
      body: vi.notifications.blockStartBody(formatTimeRange(b.start, b.end, tz), minutesBefore),
      data: { blockId: b.id, taskId: b.taskId, url: `nhip://task/${b.taskId}` },
    });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt || a.id.localeCompare(b.id)).slice(0, limit);
}

export interface ScheduledInfo {
  id: string;
}

export interface ReminderDiff {
  cancel: string[];
  schedule: LocalReminder[];
}

/**
 * Diff desired vs scheduled. Identifiers encode block start time, so a moved block is
 * cancelled + re-scheduled. Unknown ids (from older app versions) are cancelled too.
 * Cancellations are applied before scheduling, so the pending count never exceeds the limit.
 */
export function diffReminders(scheduled: readonly ScheduledInfo[], desired: readonly LocalReminder[]): ReminderDiff {
  const want = new Map(desired.map((d) => [d.id, d]));
  const have = new Set(scheduled.map((s) => s.id));
  return {
    cancel: [...have].filter((id) => !want.has(id)),
    schedule: desired.filter((d) => !have.has(d.id)),
  };
}
