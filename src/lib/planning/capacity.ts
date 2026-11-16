/**
 * Daily capacity: how many focus minutes each space may use per local day.
 * Pure and deterministic — overload figures shown in the UI come from here, never from AI.
 */
import type { Interval } from '../time/intervals';
import { APP_TZ, type DateKey, type Weekday, dateKeysInRange, localToInstant, weekdayOfKey } from '../time/tz';
import type { Space } from '../time/slots';

export interface CapacitySetting {
  space: Space;
  weekday: Weekday;
  maxFocusMinutes: number;
}

/** Defaults used when the user has not configured a weekday. */
export const DEFAULT_CAPACITY: Record<Space, Record<Weekday, number>> = {
  work: { 0: 0, 1: 360, 2: 360, 3: 360, 4: 360, 5: 360, 6: 0 },
  study: { 0: 300, 1: 150, 2: 150, 3: 150, 4: 150, 5: 150, 6: 300 },
};

export function capacityFor(settings: readonly CapacitySetting[], space: Space, weekday: Weekday): number {
  const found = settings.find((s) => s.space === space && s.weekday === weekday);
  return found ? Math.max(0, found.maxFocusMinutes) : DEFAULT_CAPACITY[space][weekday];
}

export interface SpacedInterval extends Interval {
  space: Space;
}

export type DayUsage = Record<Space, number>;

/** Minutes used per local day per space. Blocks crossing midnight are split across days. */
export function usageByDay(blocks: readonly SpacedInterval[], tz: string = APP_TZ): Map<DateKey, DayUsage> {
  const map = new Map<DateKey, DayUsage>();
  for (const b of blocks) {
    for (const key of dateKeysInRange(b.start, b.end, tz)) {
      const dayStart = localToInstant(key, 0, tz);
      const dayEnd = localToInstant(key, 1440, tz);
      const s = Math.max(b.start, dayStart);
      const e = Math.min(b.end, dayEnd);
      if (e <= s) continue;
      const usage = map.get(key) ?? { study: 0, work: 0 };
      usage[b.space] += Math.round((e - s) / 60_000);
      map.set(key, usage);
    }
  }
  return map;
}

export type LoadStatus = 'ok' | 'near' | 'over';

export interface DayLoad {
  date: DateKey;
  space: Space;
  usedMinutes: number;
  maxMinutes: number;
  /** used / max; Infinity when max is 0 and something is scheduled. */
  ratio: number;
  status: LoadStatus;
  /** Minutes above capacity (0 when not over). */
  overMinutes: number;
}

export const NEAR_CAPACITY_RATIO = 0.9;

export function dayLoad(date: DateKey, space: Space, usedMinutes: number, settings: readonly CapacitySetting[]): DayLoad {
  const maxMinutes = capacityFor(settings, space, weekdayOfKey(date));
  const ratio = maxMinutes === 0 ? (usedMinutes > 0 ? Number.POSITIVE_INFINITY : 0) : usedMinutes / maxMinutes;
  const overMinutes = Math.max(0, usedMinutes - maxMinutes);
  const status: LoadStatus = overMinutes > 0 ? 'over' : ratio >= NEAR_CAPACITY_RATIO ? 'near' : 'ok';
  return { date, space, usedMinutes, maxMinutes, ratio, status, overMinutes };
}

/** Loads for every day/space that has usage, plus all days in `dates` if given. */
export function computeLoads(
  blocks: readonly SpacedInterval[],
  settings: readonly CapacitySetting[],
  dates?: readonly DateKey[],
  tz: string = APP_TZ,
): DayLoad[] {
  const usage = usageByDay(blocks, tz);
  const keys = new Set<DateKey>([...usage.keys(), ...(dates ?? [])]);
  const out: DayLoad[] = [];
  for (const key of [...keys].sort()) {
    const u = usage.get(key) ?? { study: 0, work: 0 };
    out.push(dayLoad(key, 'work', u.work, settings));
    out.push(dayLoad(key, 'study', u.study, settings));
  }
  return out;
}

export function overloadedDays(loads: readonly DayLoad[]): DayLoad[] {
  return loads.filter((l) => l.status === 'over');
}

/** Remaining minutes for a space on a date given current usage. */
export function remainingCapacity(
  date: DateKey,
  space: Space,
  usage: ReadonlyMap<DateKey, DayUsage>,
  settings: readonly CapacitySetting[],
): number {
  const used = usage.get(date)?.[space] ?? 0;
  return Math.max(0, capacityFor(settings, space, weekdayOfKey(date)) - used);
}
