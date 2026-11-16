/** Shared fixtures for planning tests. Week of Mon 2026-11-16 in Asia/Ho_Chi_Minh. */
import type { CapacitySetting } from '../lib/planning/capacity';
import type { PlanTask } from '../lib/planning/engine';
import type { ClassSession, ScheduleException, SlotContext, WeeklyWindow, WorkHours } from '../lib/time/slots';
import { type DateKey, type HHmm, type Instant, type Weekday, localToInstant, MINUTE } from '../lib/time/tz';

export const at = (key: DateKey, t: HHmm): Instant => localToInstant(key, t);
export const mins = (n: number) => n * MINUTE;

export const MON = '2026-11-16';
export const TUE = '2026-11-17';
export const WED = '2026-11-18';
export const THU = '2026-11-19';
export const FRI = '2026-11-20';
export const SAT = '2026-11-21';
export const SUN = '2026-11-22';
export const NEXT_MON = '2026-11-23';
export const NEXT_TUE = '2026-11-24';

export const workHours: WorkHours[] = ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({
  weekday,
  start: '08:00',
  end: '17:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  enabled: true,
}));

export const studyWindows: WeeklyWindow[] = [
  ...([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, start: '19:00', end: '22:30' })),
  { weekday: 6, start: '08:00', end: '22:00' },
  { weekday: 0, start: '08:00', end: '22:00' },
];

export const classSessions: ClassSession[] = [
  { id: 'mang-tue', weekday: 2, start: '18:00', end: '20:30', validFrom: '2026-09-01', validTo: '2027-01-15' },
  { id: 'csdl-sat', weekday: 6, start: '08:00', end: '11:00', validFrom: '2026-09-01', validTo: '2027-01-15' },
];

export const exceptions: ScheduleException[] = [
  { classSessionId: 'mang-tue', date: TUE, type: 'cancelled' },
  { classSessionId: 'mang-tue', date: THU, type: 'extra', newStart: at(THU, '19:30'), newEnd: at(THU, '21:00') },
];

export const capacity: CapacitySetting[] = [];

export function ctx(overrides: Partial<SlotContext> = {}): SlotContext {
  return {
    range: { start: at(MON, '00:00'), end: at(NEXT_MON, '00:00') },
    now: at(MON, '06:00'),
    workHours,
    studyWindows,
    classSessions,
    exceptions,
    busy: [],
    quietHours: { start: '23:00', end: '06:30' },
    ...overrides,
  };
}

export function task(overrides: Partial<PlanTask> & Pick<PlanTask, 'id'>): PlanTask {
  return {
    title: `Việc ${overrides.id}`,
    space: 'work',
    priority: 2,
    deadlineAt: null,
    remainingMinutes: 60,
    createdAt: 0,
    ...overrides,
  };
}

/** Deterministic PRNG (mulberry32) for property-style tests. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
