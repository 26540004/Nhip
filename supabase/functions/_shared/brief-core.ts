/**
 * Morning brief / evening review / deadline reminder content and timing (pure).
 * Used by the push-dispatch Edge Function (what to send, when) and by the app's /brief and
 * /review screens (what to show), so both always agree. Numbers are computed by code.
 */
import { capacityFor, type CapacitySetting, usageByDay } from './planning/capacity.ts';
import { formatDurationCompact, formatDurationLong } from './planning/format.ts';
import { rankTasks } from './planning/priority.ts';
import type { QuietHours } from './planning/slots.ts';
import { addDaysToKey, dateKeyOf, hhmmToMinutes, type Instant, localToInstant, MINUTE, weekdayOfKey } from './planning/tz.ts';

export interface BriefTask {
  id: string;
  title: string;
  space: 'study' | 'work';
  priority: 1 | 2 | 3;
  status: string;
  deadline_at: string | null;
  estimate_minutes: number | null;
  parent_task_id: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface BriefBlock {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: string;
}

export interface BriefInput {
  now: Instant;
  tz: string;
  tasks: readonly BriefTask[];
  /** accepted / synced / conflict blocks */
  blocks: readonly BriefBlock[];
  capacity: readonly CapacitySetting[];
}

export interface SpaceLoad {
  space: 'study' | 'work';
  used: number;
  max: number;
}

export interface Brief {
  date: string;
  loads: SpaceLoad[];
  top: { id: string; title: string; reason: string }[];
  dueSoon: { id: string; title: string; deadline_at: string; scheduledMinutes: number; estimate: number | null }[];
  overloaded: SpaceLoad[];
  summary: string;
}

const SPACE_VI = { study: 'Học', work: 'Việc' } as const;

function minutesOf(b: BriefBlock): number {
  return Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / MINUTE);
}

export function buildBrief(input: BriefInput): Brief {
  const { now, tz } = input;
  const date = dateKeyOf(now, tz);
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const todayBlocks = input.blocks.filter((b) => dateKeyOf(Date.parse(b.start_at), tz) === date);
  const usage = usageByDay(
    todayBlocks.flatMap((b) => {
      const t = taskById.get(b.task_id);
      return t ? [{ space: t.space, start: Date.parse(b.start_at), end: Date.parse(b.end_at) }] : [];
    }),
    tz,
  ).get(date) ?? { study: 0, work: 0 };
  const wd = weekdayOfKey(date);
  const loads: SpaceLoad[] = (['work', 'study'] as const)
    .map((space) => ({ space, used: usage[space], max: capacityFor(input.capacity, space, wd) }))
    .filter((l) => l.max > 0 || l.used > 0);

  const open = input.tasks.filter((t) => (t.status === 'todo' || t.status === 'doing') && t.parent_task_id == null);
  const ranked = rankTasks(
    open.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      deadlineAt: t.deadline_at ? Date.parse(t.deadline_at) : null,
      remainingMinutes: t.estimate_minutes ?? 60,
      createdAt: Date.parse(t.created_at),
    })),
    now,
    tz,
  );
  const top = ranked.slice(0, 3).map((r) => ({ id: r.id, title: taskById.get(r.id)!.title, reason: r.reason }));

  const horizon = localToInstant(addDaysToKey(date, 8), 0, tz);
  const scheduled = new Map<string, number>();
  for (const b of input.blocks) scheduled.set(b.task_id, (scheduled.get(b.task_id) ?? 0) + minutesOf(b));
  const dueSoon = open
    .filter((t) => t.deadline_at && Date.parse(t.deadline_at) >= now && Date.parse(t.deadline_at) < horizon)
    .sort((a, b) => Date.parse(a.deadline_at!) - Date.parse(b.deadline_at!))
    .map((t) => ({
      id: t.id,
      title: t.title,
      deadline_at: t.deadline_at!,
      scheduledMinutes: scheduled.get(t.id) ?? 0,
      estimate: t.estimate_minutes,
    }));

  const overloaded = loads.filter((l) => l.used > l.max);
  const parts: string[] = [];
  const todayTasks = new Set(todayBlocks.map((b) => b.task_id)).size;
  parts.push(
    todayTasks === 0
      ? 'Hôm nay chưa có khối việc nào trên lịch.'
      : `Hôm nay có ${todayTasks} việc trên lịch (${loads.map((l) => `${SPACE_VI[l.space]} ${formatDurationCompact(l.used)}/${formatDurationCompact(l.max)}`).join(', ')}).`,
  );
  if (overloaded.length)
    parts.push(`Quá tải: ${overloaded.map((l) => `${SPACE_VI[l.space]} thừa ${formatDurationLong(l.used - l.max)}`).join(', ')}.`);
  if (top[0]) parts.push(`Ưu tiên nhất: ${top[0].title} (${top[0].reason}).`);
  if (dueSoon.length) parts.push(`${dueSoon.length} hạn chót trong 7 ngày tới.`);
  return { date, loads, top, dueSoon, overloaded, summary: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// Evening review
// ---------------------------------------------------------------------------

export interface ReviewItem {
  taskId: string;
  title: string;
  /** today's blocks of this task that are not done */
  blockIds: string[];
  dueToday: boolean;
}

export function buildReview(input: BriefInput): { items: ReviewItem[]; doneToday: BriefTask[]; summary: string } {
  const { now, tz } = input;
  const date = dateKeyOf(now, tz);
  const byTask = new Map<string, ReviewItem>();
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  for (const b of input.blocks) {
    if (dateKeyOf(Date.parse(b.start_at), tz) !== date) continue;
    const t = taskById.get(b.task_id);
    if (!t || t.status === 'done' || t.status === 'dropped') continue;
    const item = byTask.get(t.id) ?? { taskId: t.id, title: t.title, blockIds: [], dueToday: false };
    item.blockIds.push(b.id);
    byTask.set(t.id, item);
  }
  for (const t of input.tasks) {
    if ((t.status !== 'todo' && t.status !== 'doing') || t.parent_task_id != null || !t.deadline_at) continue;
    if (dateKeyOf(Date.parse(t.deadline_at), tz) > date) continue; // due today or overdue
    const item = byTask.get(t.id) ?? { taskId: t.id, title: t.title, blockIds: [], dueToday: false };
    item.dueToday = true;
    byTask.set(t.id, item);
  }
  const doneToday = input.tasks.filter((t) => t.status === 'done' && t.completed_at && dateKeyOf(Date.parse(t.completed_at), tz) === date);
  const items = [...byTask.values()];
  const summary =
    items.length === 0
      ? `Tuyệt! Hôm nay đã xong ${doneToday.length} việc, không còn gì dang dở.`
      : `Còn ${items.length} việc chưa xong hôm nay${doneToday.length ? `, đã xong ${doneToday.length} việc` : ''}. Chạm để xếp lại.`;
  return { items, doneToday, summary };
}

// ---------------------------------------------------------------------------
// When to notify (server push)
// ---------------------------------------------------------------------------

export interface ReminderSettings {
  morning_brief_time: string; // 'HH:mm:ss'
  evening_review_time: string;
  morning_brief_enabled: boolean;
  evening_review_enabled: boolean;
  deadline_offsets_minutes: number[];
  quiet_start: string | null;
  quiet_end: string | null;
}

export interface DueNotification {
  /** Dedupe key stored in notification_log (unique per user). */
  key: string;
  kind: 'morning_brief' | 'evening_review' | 'deadline';
  title: string;
  body: string;
  url: string;
}

/** Move an instant out of quiet hours (to their end). */
export function outOfQuiet(t: Instant, quiet: QuietHours | null, tz: string): Instant {
  if (!quiet) return t;
  const day = dateKeyOf(t, tz);
  const s = hhmmToMinutes(quiet.start);
  let e = hhmmToMinutes(quiet.end);
  if (e <= s) e += 1440;
  for (const key of [addDaysToKey(day, -1), day]) {
    const qs = localToInstant(key, s, tz);
    const qe = localToInstant(key, e, tz);
    if (t >= qs && t < qe) return qe;
  }
  return t;
}

function offsetLabel(min: number): string {
  if (min % 1440 === 0) return `Còn ${min / 1440} ngày`;
  if (min % 60 === 0) return `Còn ${min / 60} giờ`;
  return `Còn ${min} phút`;
}

/**
 * Notifications whose (quiet-hours-adjusted) time falls in (now − lookbackMinutes, now].
 * The cron runs every 5 minutes; a 15-minute lookback tolerates a missed run, and the
 * notification_log unique key prevents duplicates.
 */
export function dueNotifications(input: BriefInput & { settings: ReminderSettings; lookbackMinutes?: number }): DueNotification[] {
  const { now, tz, settings } = input;
  const lookback = (input.lookbackMinutes ?? 15) * MINUTE;
  const quiet =
    settings.quiet_start && settings.quiet_end ? { start: settings.quiet_start.slice(0, 5), end: settings.quiet_end.slice(0, 5) } : null;
  const inWindow = (t: Instant) => {
    const eff = outOfQuiet(t, quiet, tz);
    return eff <= now && eff > now - lookback;
  };
  const today = dateKeyOf(now, tz);
  const out: DueNotification[] = [];

  if (settings.morning_brief_enabled && inWindow(localToInstant(today, settings.morning_brief_time.slice(0, 5), tz))) {
    const brief = buildBrief(input);
    out.push({ key: `brief:${today}`, kind: 'morning_brief', title: 'Chào buổi sáng ☀️', body: brief.summary, url: 'nhip://brief' });
  }
  if (settings.evening_review_enabled && inWindow(localToInstant(today, settings.evening_review_time.slice(0, 5), tz))) {
    const review = buildReview(input);
    out.push({ key: `review:${today}`, kind: 'evening_review', title: 'Tổng kết hôm nay', body: review.summary, url: 'nhip://review' });
  }

  const scheduled = new Map<string, number>();
  for (const b of input.blocks) scheduled.set(b.task_id, (scheduled.get(b.task_id) ?? 0) + minutesOf(b));
  for (const t of input.tasks) {
    if ((t.status !== 'todo' && t.status !== 'doing') || !t.deadline_at) continue;
    const deadline = Date.parse(t.deadline_at);
    for (const off of settings.deadline_offsets_minutes) {
      const at = deadline - off * MINUTE;
      // Don't send a "7 days left" reminder for a task created yesterday with a 3-day deadline.
      if (at < Date.parse(t.created_at) || !inWindow(at)) continue;
      const sch = scheduled.get(t.id) ?? 0;
      const detail = t.estimate_minutes
        ? ` (ước tính ${formatDurationLong(t.estimate_minutes)}, ${sch > 0 ? `mới xếp được ${formatDurationLong(sch)}` : 'chưa xếp lịch'})`
        : '';
      out.push({
        key: `deadline:${t.id}:${off}:${t.deadline_at}`,
        kind: 'deadline',
        title: `${offsetLabel(off)}: ${t.title}`,
        body: `${offsetLabel(off)}: ${t.title}${detail}`,
        url: `nhip://task/${t.id}`,
      });
    }
  }
  return out;
}
