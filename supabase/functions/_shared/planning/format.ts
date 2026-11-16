import { viCore as vi } from './strings.ts';
import { APP_TZ, DAY, HOUR, type DateKey, type Instant, dateKeyOf, hhmmOf, parseDateKey, weekdayOfKey } from './tz.ts';

/** "5g20", "6g", "40p" */
export function formatDurationCompact(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return vi.duration.compact(Math.floor(m / 60), m % 60);
}

/** "40 phút", "2 giờ", "2 giờ 30 phút" */
export function formatDurationLong(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return vi.duration.minutes(rest);
  if (rest === 0) return vi.duration.hours(h);
  return `${vi.duration.hours(h)} ${vi.duration.minutes(rest)}`;
}

/** "Thứ Hai, 16/11" */
export function formatDayHeader(key: DateKey): string {
  const { m, d } = parseDateKey(key);
  return `${vi.weekdays[weekdayOfKey(key)]}, ${d}/${m}`;
}

/** "19:00–20:30" */
export function formatTimeRange(start: Instant, end: Instant, tz: string = APP_TZ): string {
  return `${hhmmOf(start, tz)}–${hhmmOf(end, tz)}`;
}

/** Deadline countdown: "Quá hạn 2 ngày", "Hôm nay", "Ngày mai", "còn 5 ngày". Calendar-day based. */
export function formatCountdown(deadline: Instant, now: Instant, tz: string = APP_TZ): string {
  const dk = dateKeyOf(deadline, tz);
  const nk = dateKeyOf(now, tz);
  const days = Math.round((Date.parse(`${dk}T00:00:00Z`) - Date.parse(`${nk}T00:00:00Z`)) / DAY);
  if (deadline < now) return vi.countdown.overdue(-days);
  if (days === 0) {
    const hours = Math.floor((deadline - now) / HOUR);
    return hours >= 1 ? vi.countdown.hours(hours) : vi.countdown.today;
  }
  if (days === 1) return vi.countdown.tomorrow;
  return vi.countdown.days(days);
}
