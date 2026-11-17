import {
  crossesMidnight,
  fromMin,
  overlappingSessions,
  sortByWeekThenTime,
  stepCapacity,
  summarizeWindows,
  summarizeWorkHours,
  toMin,
  validateSession,
  validateWindow,
  validateWorkHours,
  weekdayRange,
} from '../lib/settings/hours';

const day = (
  weekday: number,
  enabled = true,
  start = '08:00:00',
  end = '17:00:00',
  bs: string | null = '12:00:00',
  be: string | null = '13:00:00',
) => ({
  weekday,
  enabled,
  start_time: start,
  end_time: end,
  break_start: bs,
  break_end: be,
});

describe('settings hours', () => {
  it('converts times', () => {
    expect(toMin('08:30:00')).toBe(510);
    expect(fromMin(510)).toBe('08:30');
    expect(fromMin(1440 + 15)).toBe('00:15');
  });

  it('validates office hours with lunch break', () => {
    expect(validateWorkHours(day(1))).toBeNull();
    expect(validateWorkHours(day(1, true, '17:00', '08:00'))).toBe('end_before_start');
    expect(validateWorkHours(day(1, true, '08:00', '08:15', null, null))).toBe('too_short');
    expect(validateWorkHours(day(1, true, '08:00', '17:00', '07:30', '08:30'))).toBe('break_outside');
    expect(validateWorkHours(day(1, true, '08:00', '17:00', '13:00', '12:00'))).toBe('break_order');
    expect(validateWorkHours(day(1, true, '08:00', '17:00', '12:00', null))).toBe('break_order');
    expect(validateWorkHours(day(1, true, '08:00', '17:00', null, null))).toBeNull();
  });

  it('study windows may cross midnight; class sessions may not', () => {
    expect(validateWindow('22:00', '01:00')).toBeNull();
    expect(crossesMidnight('22:00', '01:00')).toBe(true);
    expect(validateWindow('19:00', '19:00')).toBe('same_time');
    expect(validateSession('07:30', '11:00')).toBeNull();
    expect(validateSession('11:00', '07:30')).toBe('end_before_start');
    expect(validateSession('07:30', '07:40')).toBe('too_short');
  });

  it('finds overlapping class sessions on the same weekday only', () => {
    const sessions = [
      { id: 'a', weekday: 2, start_time: '07:30', end_time: '09:45' },
      { id: 'b', weekday: 2, start_time: '13:00', end_time: '15:15' },
      { id: 'c', weekday: 3, start_time: '07:30', end_time: '09:45' },
    ];
    expect(overlappingSessions(sessions, { weekday: 2, start_time: '09:00', end_time: '10:00' })).toEqual(['a']);
    expect(overlappingSessions(sessions, { weekday: 2, start_time: '09:45', end_time: '13:00' })).toEqual([]);
    expect(overlappingSessions(sessions, { id: 'a', weekday: 2, start_time: '08:00', end_time: '09:00' })).toEqual([]);
    expect(sortByWeekThenTime([...sessions, { id: 'd', weekday: 0, start_time: '08:00', end_time: '09:00' }]).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('summarises Monday-first weekday ranges', () => {
    expect(weekdayRange([1, 2, 3, 4, 5])).toBe('T2–T6');
    expect(weekdayRange([1, 3, 5])).toBe('T2, T4, T6');
    expect(weekdayRange([6, 0])).toBe('T7, CN');
    expect(weekdayRange([1, 2])).toBe('T2, T3');
  });

  it('summarises office hours and study windows', () => {
    const rows = [day(0, false), day(1), day(2), day(3), day(4), day(5, true, '08:00', '12:00', null, null), day(6, false)];
    expect(summarizeWorkHours(rows)).toBe('T2–T5 08:00–17:00, nghỉ 12:00–13:00 · T6 08:00–12:00');
    expect(summarizeWorkHours(rows.map((r) => ({ ...r, enabled: false })))).toBe('Không có giờ hành chính');
    expect(
      summarizeWindows([
        { id: '1', weekday: 1, start_time: '19:00', end_time: '22:30' },
        { id: '2', weekday: 2, start_time: '19:00', end_time: '22:30' },
        { id: '3', weekday: 0, start_time: '08:00', end_time: '22:00' },
      ]),
    ).toBe('T2, T3 19:00–22:30 · CN 08:00–22:00');
    expect(
      summarizeWindows([
        { id: '3', weekday: 0, start_time: '08:00', end_time: '22:00' },
        { id: '1', weekday: 1, start_time: '19:00', end_time: '22:30' },
      ]),
    ).toBe('T2 19:00–22:30 · CN 08:00–22:00');
  });

  it('steps capacity in 15-minute increments within 0–12 h', () => {
    expect(stepCapacity(150, 30)).toBe(180);
    expect(stepCapacity(10, -30)).toBe(0);
    expect(stepCapacity(700, 60)).toBe(720);
  });
});
