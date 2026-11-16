/**
 * Deterministic priority ranking with a one-line Vietnamese reason.
 * The AI may supply its own `priority_reason` on parse; this ranking is what orders
 * lists and the morning brief, so it is always explainable and reproducible.
 */
import { vi } from '../../i18n/vi';
import { formatDurationLong } from '../time/format';
import { APP_TZ, DAY, type Instant, dateKeyOf } from '../time/tz';

export type Priority = 1 | 2 | 3;

export interface RankableTask {
  id: string;
  title: string;
  priority: Priority;
  deadlineAt: Instant | null;
  /** Minutes still to do (estimate − actual progress). */
  remainingMinutes: number;
  createdAt: Instant;
  /** Optional: free minutes in the task's space before its deadline (from slots). */
  freeMinutesBeforeDeadline?: number | null;
}

export interface RankedTask {
  id: string;
  score: number;
  reason: string;
}

const PRIORITY_WEIGHT: Record<Priority, number> = { 1: 60, 2: 35, 3: 15 };

function calendarDaysBetween(a: Instant, b: Instant, tz: string): number {
  const ak = Date.parse(`${dateKeyOf(a, tz)}T00:00:00Z`);
  const bk = Date.parse(`${dateKeyOf(b, tz)}T00:00:00Z`);
  return Math.round((bk - ak) / DAY);
}

export function scoreTask(task: RankableTask, now: Instant, tz: string = APP_TZ): RankedTask {
  let score = PRIORITY_WEIGHT[task.priority];
  const reasons: { weight: number; text: string }[] = [];

  if (task.priority === 1) reasons.push({ weight: 20, text: vi.priorityReason.highPriority });

  if (task.deadlineAt == null) {
    reasons.push({ weight: 0, text: vi.priorityReason.noDeadline });
  } else if (task.deadlineAt < now) {
    score += 100; // overdue always outranks not-yet-due work
    reasons.push({ weight: 100, text: vi.priorityReason.overdue });
  } else {
    const days = calendarDaysBetween(now, task.deadlineAt, tz);
    if (days === 0) {
      score += 50;
      reasons.push({ weight: 90, text: vi.priorityReason.dueToday });
    } else if (days === 1) {
      score += 40;
      reasons.push({ weight: 80, text: vi.priorityReason.dueTomorrow });
    } else if (days <= 3) {
      score += 28;
      reasons.push({ weight: 60, text: vi.priorityReason.dueSoon(days) });
    } else if (days <= 7) {
      score += 15;
      reasons.push({ weight: 40, text: vi.priorityReason.dueSoon(days) });
    } else {
      score += 5;
    }

    const free = task.freeMinutesBeforeDeadline;
    if (free != null && task.remainingMinutes > 0) {
      const tightness = free <= 0 ? Number.POSITIVE_INFINITY : task.remainingMinutes / free;
      if (tightness >= 0.6) {
        score += 20;
        reasons.push({ weight: 70, text: vi.priorityReason.tightTime(formatDurationLong(task.remainingMinutes)) });
      }
    }
  }

  const top = reasons
    .filter((r) => r.weight > 0 || reasons.length === 1)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((r) => r.text);
  return { id: task.id, score, reason: top.join(vi.priorityReason.join) };
}

/** Highest score first; ties → earlier deadline (none last) → older task. */
export function rankTasks(tasks: readonly RankableTask[], now: Instant, tz: string = APP_TZ): RankedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks
    .map((t) => scoreTask(t, now, tz))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ta = byId.get(a.id)!;
      const tb = byId.get(b.id)!;
      const da = ta.deadlineAt ?? Number.POSITIVE_INFINITY;
      const db = tb.deadlineAt ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return ta.createdAt - tb.createdAt;
    });
}
