/**
 * Timezone helpers. All instants are epoch milliseconds (UTC). Local calendar dates are
 * represented as `DateKey` strings ('yyyy-MM-dd') and local wall-clock times as `HHmm`
 * strings ('HH:mm'). Conversion happens only through these functions.
 *
 * Asia/Ho_Chi_Minh has no DST (fixed +07:00), but nothing here assumes that, so other
 * zones work for a future multi-user version.
 *
 * Implemented with Intl only (no npm deps) so the same file runs in the app and in Deno.
 */

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

// ---------------------------------------------------------------------------
// Intl helpers (formatters are cached per zone — they are expensive to create)
// ---------------------------------------------------------------------------

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

function partsOf(instant: Instant, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, hh: out.hour! % 24, mm: out.minute!, ss: out.second! };
}

/** Zone offset in minutes at an instant (e.g. +420 for +07:00). */
export function offsetMinutes(instant: Instant, tz: string = APP_TZ): number {
  const p = partsOf(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

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
  const p = partsOf(instant, tz);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** Local 'HH:mm' of an instant in the given zone. */
export function hhmmOf(instant: Instant, tz: string = APP_TZ): HHmm {
  const p = partsOf(instant, tz);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** Instant for a local date + wall-clock time. Accepts minutes ≥ 1440 (rolls into next days). */
export function localToInstant(key: DateKey, minutesOrHHmm: number | HHmm, tz: string = APP_TZ): Instant {
  const minutes = typeof minutesOrHHmm === 'number' ? minutesOrHHmm : hhmmToMinutes(minutesOrHHmm);
  const dayOffset = Math.floor(minutes / 1440);
  const rest = minutes - dayOffset * 1440;
  const { y, m, d } = parseDateKey(dayOffset === 0 ? key : addDaysToKey(key, dayOffset));
  const naive = Date.UTC(y, m - 1, d, Math.floor(rest / 60), rest % 60);
  // Two passes settle correctly across DST transitions in zones that have them.
  let guess = naive - offsetMinutes(naive, tz) * MINUTE;
  guess = naive - offsetMinutes(guess, tz) * MINUTE;
  return guess;
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
  const p = partsOf(instant, tz);
  const off = offsetMinutes(instant, tz);
  const a = Math.abs(off);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}${off >= 0 ? '+' : '-'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

export function parseIso(iso: string): Instant {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Invalid ISO datetime: ${iso}`);
  return t;
}
