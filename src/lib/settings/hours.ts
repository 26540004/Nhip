/**
 * Settings helpers (pure, unit-tested): validation of office hours, study windows and
 * class sessions, plus the short Vietnamese summaries shown in Settings and onboarding.
 * Times are "HH:mm" (Postgres may return "HH:mm:ss"; both are accepted).
 */
import { vi } from '../../i18n/vi';
import type { CapacityRow, ClassSessionRow, Space, StudyWindowRow, WorkHoursRow } from '../api/types';

/** Monday first, the way Vietnamese timetables are written. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function toMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

export function fromMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export type HoursError = 'end_before_start' | 'break_outside' | 'break_order' | 'same_time' | 'too_short';

export function validateWorkHours(row: Pick<WorkHoursRow, 'start_time' | 'end_time' | 'break_start' | 'break_end'>): HoursError | null {
  const s = toMin(row.start_time);
  const e = toMin(row.end_time);
  if (e <= s) return 'end_before_start';
  if (e - s < 30) return 'too_short';
  if ((row.break_start == null) !== (row.break_end == null)) return 'break_order';
  if (row.break_start != null && row.break_end != null) {
    const bs = toMin(row.break_start);
    const be = toMin(row.break_end);
    if (be <= bs) return 'break_order';
    if (bs < s || be > e) return 'break_outside';
  }
  return null;
}

/** Study windows may cross midnight (22:00 → 01:00); only identical times are invalid. */
export function validateWindow(start: string, end: string): HoursError | null {
  if (toMin(start) === toMin(end)) return 'same_time';
  return null;
}

export function crossesMidnight(start: string, end: string): boolean {
  return toMin(end) <= toMin(start);
}

export function validateSession(start: string, end: string): HoursError | null {
  const s = toMin(start);
  const e = toMin(end);
  if (e <= s) return 'end_before_start';
  if (e - s < 15) return 'too_short';
  return null;
}

/** Other sessions on the same weekday that overlap [start, end). */
export function overlappingSessions(
  sessions: readonly Pick<ClassSessionRow, 'id' | 'weekday' | 'start_time' | 'end_time'>[],
  candidate: { id?: string; weekday: number; start_time: string; end_time: string },
): string[] {
  const s = toMin(candidate.start_time);
  const e = toMin(candidate.end_time);
  return sessions
    .filter((x) => x.id !== candidate.id && x.weekday === candidate.weekday && toMin(x.start_time) < e && toMin(x.end_time) > s)
    .map((x) => x.id);
}

export function sortByWeekThenTime<T extends { weekday: number; start_time: string }>(rows: readonly T[]): T[] {
  const pos = (w: number) => WEEK_ORDER.indexOf(w as (typeof WEEK_ORDER)[number]);
  return [...rows].sort((a, b) => pos(a.weekday) - pos(b.weekday) || toMin(a.start_time) - toMin(b.start_time));
}

/** "T2, T3, T4" → "T2–T4" for consecutive Monday-first days. */
export function weekdayRange(days: readonly number[]): string {
  const idx = WEEK_ORDER.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  const parts: string[] = [];
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j]! + 1) j++;
    const a = vi.weekdaysShort[WEEK_ORDER[idx[i]!]!];
    const b = vi.weekdaysShort[WEEK_ORDER[idx[j]!]!];
    parts.push(j - i >= 2 ? `${a}–${b}` : j > i ? `${a}, ${b}` : a);
    i = j + 1;
  }
  return parts.join(', ');
}

/** "T2–T6 08:00–17:00, nghỉ 12:00–13:00" (groups identical days). */
export function summarizeWorkHours(rows: readonly WorkHoursRow[]): string {
  const enabled = sortByWeekThenTime(rows.filter((r) => r.enabled));
  if (enabled.length === 0) return vi.settingsPages.workHours.none;
  const groups = new Map<string, number[]>();
  for (const r of enabled) {
    const key = `${hhmm(r.start_time)}–${hhmm(r.end_time)}${r.break_start ? `|${hhmm(r.break_start)}–${hhmm(r.break_end)}` : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), r.weekday]);
  }
  return [...groups.entries()]
    .map(([key, days]) => {
      const [hours, lunch] = key.split('|');
      return `${weekdayRange(days)} ${hours}${lunch ? vi.settingsPages.workHours.lunchSuffix(lunch) : ''}`;
    })
    .join(' · ');
}

export function summarizeCapacity(rows: readonly CapacityRow[], space: Space): number {
  return rows.filter((r) => r.space === space).reduce((s, r) => s + r.max_focus_minutes, 0);
}

export function summarizeWindows(rows: readonly StudyWindowRow[]): string {
  if (rows.length === 0) return vi.settingsPages.studyWindows.none;
  const groups = new Map<string, number[]>();
  for (const r of sortByWeekThenTime(rows)) {
    const key = `${hhmm(r.start_time)}–${hhmm(r.end_time)}`;
    groups.set(key, [...(groups.get(key) ?? []), r.weekday]);
  }
  return [...groups.entries()].map(([k, days]) => `${weekdayRange(days)} ${k}`).join(' · ');
}

export const DEFAULT_OFFICE: Omit<WorkHoursRow, 'weekday' | 'enabled'> = {
  start_time: '08:00',
  end_time: '17:00',
  break_start: '12:00',
  break_end: '13:00',
};

/** Clamp a capacity to 0…12 h in 15-minute steps. */
export function stepCapacity(current: number, delta: number): number {
  return Math.max(0, Math.min(720, Math.round((current + delta) / 15) * 15));
}
