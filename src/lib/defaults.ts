/**
 * Default weekly rules — mirror the values the signup trigger inserts
 * (supabase/migrations/…_schema.sql, handle_new_user). Used before settings load.
 */
import type { WeeklyWindow, WorkHours } from './time/slots';
import type { Weekday } from './time/tz';

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_WORK_HOURS: WorkHours[] = WEEKDAYS.map((weekday) => ({
  weekday,
  start: '08:00',
  end: '17:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  enabled: weekday >= 1 && weekday <= 5,
}));

export const DEFAULT_STUDY_WINDOWS: WeeklyWindow[] = WEEKDAYS.map((weekday) =>
  weekday === 0 || weekday === 6 ? { weekday, start: '08:00', end: '22:00' } : { weekday, start: '19:00', end: '22:30' },
);

export const DEFAULT_REMINDERS = {
  morningBriefTime: '07:00',
  eveningReviewTime: '21:30',
  deadlineOffsetsMinutes: [7 * 24 * 60, 24 * 60],
  startOffsetMinutes: 10,
  quietHours: { start: '23:00', end: '06:30' },
} as const;
