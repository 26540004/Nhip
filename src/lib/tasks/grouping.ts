/**
 * Task list grouping (spec §H.4): Quá hạn · Hôm nay · Tuần này · Sau đó · Không có hạn · Đã xong.
 * Pure; local-day boundaries come from the user's timezone. Weeks start on Monday.
 */
import type { Space, Task } from '../api/types';
import { APP_TZ, addDaysToKey, dateKeyOf, localToInstant, weekdayOfKey } from '../time/tz';

export type TaskGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'noDeadline' | 'done';
export const GROUP_ORDER: TaskGroupKey[] = ['overdue', 'today', 'week', 'later', 'noDeadline', 'done'];

export type SortMode = 'deadline' | 'priority';

export interface TaskFilter {
  space?: Space | 'all';
  collectionId?: string | null;
  priority?: 1 | 2 | 3 | null;
}

export function groupOf(task: Pick<Task, 'status' | 'deadline_at'>, now: number, tz: string = APP_TZ): TaskGroupKey | null {
  if (task.status === 'dropped') return null;
  if (task.status === 'done') return 'done';
  if (!task.deadline_at) return 'noDeadline';
  const dl = Date.parse(task.deadline_at);
  if (dl < now) return 'overdue';
  const today = dateKeyOf(now, tz);
  const tomorrowStart = localToInstant(addDaysToKey(today, 1), 0, tz);
  if (dl < tomorrowStart) return 'today';
  const daysToMonday = (8 - weekdayOfKey(today)) % 7 || 7; // next Monday
  const nextWeekStart = localToInstant(addDaysToKey(today, daysToMonday), 0, tz);
  return dl < nextWeekStart ? 'week' : 'later';
}

function compare(a: Task, b: Task, sort: SortMode): number {
  const da = a.deadline_at ? Date.parse(a.deadline_at) : Number.POSITIVE_INFINITY;
  const db = b.deadline_at ? Date.parse(b.deadline_at) : Number.POSITIVE_INFINITY;
  if (sort === 'priority' && a.priority !== b.priority) return a.priority - b.priority;
  if (da !== db) return da - db;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.created_at.localeCompare(b.created_at);
}

export function filterTasks(tasks: readonly Task[], f: TaskFilter): Task[] {
  return tasks.filter(
    (t) =>
      t.parent_task_id == null &&
      (!f.space || f.space === 'all' || t.space === f.space) &&
      (!f.collectionId || t.collection_id === f.collectionId) &&
      (!f.priority || t.priority === f.priority),
  );
}

export function groupTasks(
  tasks: readonly Task[],
  now: number,
  opts: { sort?: SortMode; tz?: string } = {},
): { key: TaskGroupKey; tasks: Task[] }[] {
  const sort = opts.sort ?? 'deadline';
  const buckets = new Map<TaskGroupKey, Task[]>();
  for (const t of tasks) {
    const g = groupOf(t, now, opts.tz);
    if (!g) continue;
    const list = buckets.get(g) ?? [];
    list.push(t);
    buckets.set(g, list);
  }
  return GROUP_ORDER.filter((k) => buckets.has(k)).map((key) => {
    const list = buckets.get(key)!;
    if (key === 'done') list.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    else list.sort((a, b) => compare(a, b, sort));
    return { key, tasks: list };
  });
}

/** Today's and overdue open tasks without any accepted/synced block → "Chưa xếp lịch". */
export function unscheduledForToday(
  tasks: readonly Task[],
  scheduledTaskIds: ReadonlySet<string>,
  now: number,
  tz: string = APP_TZ,
): Task[] {
  return tasks
    .filter((t) => t.parent_task_id == null && !scheduledTaskIds.has(t.id))
    .filter((t) => {
      const g = groupOf(t, now, tz);
      return g === 'overdue' || g === 'today';
    })
    .sort((a, b) => compare(a, b, 'deadline'));
}

/** Subtasks of a task in display order. */
export function subtasksOf(tasks: readonly Task[], parentId: string): Task[] {
  return tasks
    .filter((t) => t.parent_task_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}
