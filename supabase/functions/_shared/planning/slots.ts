/**
 * Free-slot computation. Pure: everything comes in through `SlotContext`.
 *
 * Rules (spec §I.2):
 *  - Work: inside office hours on enabled weekdays, excluding the lunch break.
 *  - Study: inside study windows, never overlapping classes or office hours.
 *  - Both: never overlapping Google busy times, existing accepted blocks, classes,
 *    quiet hours, or the past.
 */
import { type Interval, clip, mergeIntervals, subtractIntervals } from './intervals.ts';
import {
  APP_TZ,
  type DateKey,
  type HHmm,
  type Instant,
  type Weekday,
  addDaysToKey,
  dateKeysInRange,
  hhmmToMinutes,
  localToInstant,
  weekdayOfKey,
} from './tz.ts';

export type Space = 'study' | 'work';

export interface WorkHours {
  weekday: Weekday;
  start: HHmm;
  end: HHmm;
  breakStart?: HHmm | null;
  breakEnd?: HHmm | null;
  enabled: boolean;
}

/** A weekly window. If `end` ≤ `start` the window crosses midnight into the next day. */
export interface WeeklyWindow {
  weekday: Weekday;
  start: HHmm;
  end: HHmm;
}

export interface ClassSession {
  id: string;
  weekday: Weekday;
  start: HHmm;
  end: HHmm;
  validFrom?: DateKey | null;
  validTo?: DateKey | null;
}

export interface ScheduleException {
  classSessionId: string | null;
  date: DateKey;
  type: 'cancelled' | 'moved' | 'extra';
  newStart?: Instant | null;
  newEnd?: Instant | null;
}

/** Daily quiet hours, local times. Wraps midnight when end ≤ start (e.g. 22:30 → 07:00). */
export interface QuietHours {
  start: HHmm;
  end: HHmm;
}

export interface SlotContext {
  tz?: string;
  range: Interval;
  /** Instants before `now` are never free. */
  now?: Instant;
  workHours: readonly WorkHours[];
  studyWindows: readonly WeeklyWindow[];
  classSessions: readonly ClassSession[];
  exceptions: readonly ScheduleException[];
  /** Google busy times + already accepted/synced app blocks. */
  busy: readonly Interval[];
  quietHours?: QuietHours | null;
}

/** Local dates to expand weekly rules over: one day of padding each side for midnight-crossing windows. */
function paddedKeys(range: Interval, tz: string): DateKey[] {
  const keys = dateKeysInRange(range.start, range.end, tz);
  if (keys.length === 0) return [];
  return [addDaysToKey(keys[0]!, -1), ...keys];
}

function windowOn(key: DateKey, start: HHmm, end: HHmm, tz: string): Interval {
  const s = hhmmToMinutes(start);
  let e = hhmmToMinutes(end);
  if (e <= s) e += 1440; // crosses midnight
  return { start: localToInstant(key, s, tz), end: localToInstant(key, e, tz) };
}

/** Office hours as intervals (full span, lunch included). */
export function officeSpans(ctx: SlotContext): Interval[] {
  const tz = ctx.tz ?? APP_TZ;
  const out: Interval[] = [];
  for (const key of paddedKeys(ctx.range, tz)) {
    const wd = weekdayOfKey(key);
    for (const wh of ctx.workHours) {
      if (!wh.enabled || wh.weekday !== wd) continue;
      out.push(windowOn(key, wh.start, wh.end, tz));
    }
  }
  return clip(mergeIntervals(out), ctx.range);
}

/** Lunch breaks as intervals. */
export function lunchBreaks(ctx: SlotContext): Interval[] {
  const tz = ctx.tz ?? APP_TZ;
  const out: Interval[] = [];
  for (const key of paddedKeys(ctx.range, tz)) {
    const wd = weekdayOfKey(key);
    for (const wh of ctx.workHours) {
      if (!wh.enabled || wh.weekday !== wd || !wh.breakStart || !wh.breakEnd) continue;
      out.push(windowOn(key, wh.breakStart, wh.breakEnd, tz));
    }
  }
  return clip(mergeIntervals(out), ctx.range);
}

/** Office hours minus lunch — the only time work tasks may be scheduled. */
export function workWindows(ctx: SlotContext): Interval[] {
  return subtractIntervals(officeSpans(ctx), lunchBreaks(ctx));
}

export function studyWindowIntervals(ctx: SlotContext): Interval[] {
  const tz = ctx.tz ?? APP_TZ;
  const out: Interval[] = [];
  for (const key of paddedKeys(ctx.range, tz)) {
    const wd = weekdayOfKey(key);
    for (const w of ctx.studyWindows) {
      if (w.weekday !== wd) continue;
      out.push(windowOn(key, w.start, w.end, tz));
    }
  }
  return clip(mergeIntervals(out), ctx.range);
}

export interface ClassOccurrence extends Interval {
  classSessionId: string | null;
  date: DateKey;
  kind: 'regular' | 'moved' | 'extra';
}

/** Class occurrences with per-date exceptions applied. */
export function classOccurrences(ctx: SlotContext): ClassOccurrence[] {
  const tz = ctx.tz ?? APP_TZ;
  const out: ClassOccurrence[] = [];
  const cancelled = new Set(
    ctx.exceptions.filter((e) => e.type === 'cancelled' || e.type === 'moved').map((e) => `${e.classSessionId ?? ''}|${e.date}`),
  );

  for (const key of paddedKeys(ctx.range, tz)) {
    const wd = weekdayOfKey(key);
    for (const cs of ctx.classSessions) {
      if (cs.weekday !== wd) continue;
      if (cs.validFrom && key < cs.validFrom) continue;
      if (cs.validTo && key > cs.validTo) continue;
      if (cancelled.has(`${cs.id}|${key}`)) continue;
      const iv = windowOn(key, cs.start, cs.end, tz);
      out.push({ ...iv, classSessionId: cs.id, date: key, kind: 'regular' });
    }
  }
  for (const e of ctx.exceptions) {
    if ((e.type === 'moved' || e.type === 'extra') && e.newStart != null && e.newEnd != null && e.newEnd > e.newStart) {
      out.push({
        start: e.newStart,
        end: e.newEnd,
        classSessionId: e.classSessionId,
        date: e.date,
        kind: e.type === 'moved' ? 'moved' : 'extra',
      });
    }
  }
  return out.filter((o) => o.start < ctx.range.end && ctx.range.start < o.end).sort((a, b) => a.start - b.start);
}

export function quietIntervals(ctx: SlotContext): Interval[] {
  if (!ctx.quietHours) return [];
  const tz = ctx.tz ?? APP_TZ;
  const out: Interval[] = [];
  for (const key of paddedKeys(ctx.range, tz)) {
    out.push(windowOn(key, ctx.quietHours.start, ctx.quietHours.end, tz));
  }
  return clip(mergeIntervals(out), ctx.range);
}

/** Everything that blocks any task, regardless of space. */
export function hardBlockers(ctx: SlotContext): Interval[] {
  const past: Interval[] = ctx.now != null && ctx.now > ctx.range.start ? [{ start: ctx.range.start, end: ctx.now }] : [];
  return mergeIntervals([...classOccurrences(ctx), ...ctx.busy, ...quietIntervals(ctx), ...past]);
}

/** The windows a space may use, before subtracting busy time. */
export function allowedWindows(ctx: SlotContext, space: Space): Interval[] {
  if (space === 'work') return workWindows(ctx);
  // Study never overlaps office hours (full span, lunch included).
  return subtractIntervals(studyWindowIntervals(ctx), officeSpans(ctx));
}

export interface FreeSlots {
  work: Interval[];
  study: Interval[];
}

export function computeFreeSlots(ctx: SlotContext): FreeSlots {
  const blockers = hardBlockers(ctx);
  return {
    work: subtractIntervals(allowedWindows(ctx, 'work'), blockers),
    study: subtractIntervals(allowedWindows(ctx, 'study'), blockers),
  };
}
