/**
 * Timezone helpers. All instants are epoch milliseconds (UTC). Local calendar dates are
 * represented as `DateKey` strings ('yyyy-MM-dd') and local wall-clock times as `HHmm`
 * strings ('HH:mm'). Conversion happens only through these functions.
 *
 * Asia/Ho_Chi_Minh has no DST (fixed +07:00), but nothing here assumes that, so other
 * zones work for a future multi-user version.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const APP_TZ = 'Asia/Ho_Chi_Minh';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Epoch milliseconds, UTC. */
export type Instant = number;
/** Local calendar date 'yyyy-MM-dd'. */
export type DateKey = string;
/** Local wall-clock time 'HH:mm' (00:00–24:00). */
export type HHmm = string;
/** 0 = Sunday … 6 = Saturday (same as JS getDay and Postgres extract(dow)). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

export function parseDateKey(key: DateKey): { y: number; m: number; d: number } {
  const match = DATE_KEY_RE.exec(key);
  if (!match) throw new Error(`Invalid DateKey: ${key}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Minutes since local midnight for an 'HH:mm' string. '24:00' → 1440. */
export function hhmmToMinutes(t: HHmm): number {
  const match = HHMM_RE.exec(t);
  if (!match) throw new Error(`Invalid HH:mm: ${t}`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 1440) throw new Error(`Invalid HH:mm: ${t}`);
  return minutes;
}

export function minutesToHHmm(minutes: number): HHmm {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDaysToKey(key: DateKey, days: number): DateKey {
  const { y, m, d } = parseDateKey(key);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function weekdayOfKey(key: DateKey): Weekday {
  const { y, m, d } = parseDateKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

/** Local date of an instant in the given zone. */
export function dateKeyOf(instant: Instant, tz: string = APP_TZ): DateKey {
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/** Local 'HH:mm' of an instant in the given zone. */
export function hhmmOf(instant: Instant, tz: string = APP_TZ): HHmm {
  return formatInTimeZone(instant, tz, 'HH:mm');
}

/** Instant for a local date + wall-clock time. Accepts minutes ≥ 1440 (rolls into next days). */
export function localToInstant(key: DateKey, minutesOrHHmm: number | HHmm, tz: string = APP_TZ): Instant {
  const minutes = typeof minutesOrHHmm === 'number' ? minutesOrHHmm : hhmmToMinutes(minutesOrHHmm);
  const dayOffset = Math.floor(minutes / 1440);
  const rest = minutes - dayOffset * 1440;
  const dayKey = dayOffset === 0 ? key : addDaysToKey(key, dayOffset);
  return fromZonedTime(`${dayKey}T${minutesToHHmm(rest)}:00`, tz).getTime();
}

/** Start of the local day (00:00) as an instant. */
export function startOfLocalDay(key: DateKey, tz: string = APP_TZ): Instant {
  return localToInstant(key, 0, tz);
}

/** Every local date touched by [start, end). Inclusive of the date containing `start`. */
export function dateKeysInRange(start: Instant, end: Instant, tz: string = APP_TZ): DateKey[] {
  if (end <= start) return [];
  const keys: DateKey[] = [];
  const last = dateKeyOf(end - 1, tz);
  let key = dateKeyOf(start, tz);
  // Bounded loop: guards against bad input producing an endless range.
  for (let i = 0; i < 3660; i++) {
    keys.push(key);
    if (key === last) break;
    key = addDaysToKey(key, 1);
  }
  return keys;
}

/** ISO string with explicit local offset, e.g. '2026-11-20T17:00:00+07:00'. */
export function toLocalIso(instant: Instant, tz: string = APP_TZ): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export function parseIso(iso: string): Instant {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Invalid ISO datetime: ${iso}`);
  return t;
}
