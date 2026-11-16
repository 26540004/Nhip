/**
 * DB rows → pure scheduling inputs (SlotContext pieces, capacity settings).
 * Falls back to defaults before settings load (e.g. first offline launch).
 */
import type { SettingsBundle } from '../api/queries';
import type { CapacitySetting } from '../planning/capacity';
import { DEFAULT_STUDY_WINDOWS, DEFAULT_WORK_HOURS } from '../defaults';
import type { ClassSession, QuietHours, ScheduleException, WeeklyWindow, WorkHours } from '../time/slots';
import { APP_TZ, type Weekday } from '../time/tz';

/** 'HH:mm:ss' → 'HH:mm' */
export const hm = (t: string): string => t.slice(0, 5);

export interface Rules {
  tz: string;
  workHours: WorkHours[];
  studyWindows: WeeklyWindow[];
  classSessions: ClassSession[];
  exceptions: ScheduleException[];
  capacity: CapacitySetting[];
  quietHours: QuietHours | null;
  startOffsetMinutes: number;
}

export function rulesFromSettings(s: SettingsBundle | undefined): Rules {
  if (!s) {
    return {
      tz: APP_TZ,
      workHours: DEFAULT_WORK_HOURS,
      studyWindows: DEFAULT_STUDY_WINDOWS,
      classSessions: [],
      exceptions: [],
      capacity: [],
      quietHours: { start: '23:00', end: '06:30' },
      startOffsetMinutes: 10,
    };
  }
  return {
    tz: s.profile?.timezone ?? APP_TZ,
    workHours: s.workHours.length
      ? s.workHours.map((w) => ({
          weekday: w.weekday as Weekday,
          start: hm(w.start_time),
          end: hm(w.end_time),
          breakStart: w.break_start ? hm(w.break_start) : null,
          breakEnd: w.break_end ? hm(w.break_end) : null,
          enabled: w.enabled,
        }))
      : DEFAULT_WORK_HOURS,
    studyWindows: s.studyWindows.map((w) => ({ weekday: w.weekday as Weekday, start: hm(w.start_time), end: hm(w.end_time) })),
    classSessions: s.classSessions.map((c) => ({
      id: c.id,
      weekday: c.weekday as Weekday,
      start: hm(c.start_time),
      end: hm(c.end_time),
      validFrom: c.valid_from,
      validTo: c.valid_to,
    })),
    exceptions: s.exceptions.map((e) => ({
      classSessionId: e.class_session_id,
      date: e.date,
      type: e.type,
      newStart: e.new_start_at ? Date.parse(e.new_start_at) : null,
      newEnd: e.new_end_at ? Date.parse(e.new_end_at) : null,
    })),
    capacity: s.capacity.map((c) => ({ space: c.space, weekday: c.weekday as Weekday, maxFocusMinutes: c.max_focus_minutes })),
    quietHours:
      s.reminders?.quiet_start && s.reminders.quiet_end ? { start: hm(s.reminders.quiet_start), end: hm(s.reminders.quiet_end) } : null,
    startOffsetMinutes: s.reminders?.start_offset_minutes ?? 10,
  };
}
