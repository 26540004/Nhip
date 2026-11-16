import { addDaysToKey, dateKeyOf, dateKeysInRange, hhmmToMinutes, localToInstant, toLocalIso, weekdayOfKey } from '../lib/time/tz';
import { formatCountdown, formatDayHeader, formatDurationCompact, formatDurationLong, formatTimeRange } from '../lib/time/format';
import { at, MON } from './fixtures';

describe('tz', () => {
  it('converts local +07:00 wall time to UTC', () => {
    expect(new Date(localToInstant(MON, '08:00')).toISOString()).toBe('2026-11-16T01:00:00.000Z');
    expect(new Date(localToInstant(MON, '00:00')).toISOString()).toBe('2026-11-15T17:00:00.000Z');
  });

  it('handles 24:00 and minutes past midnight', () => {
    expect(localToInstant(MON, '24:00')).toBe(localToInstant('2026-11-17', '00:00'));
    expect(localToInstant(MON, 1440 + 60)).toBe(localToInstant('2026-11-17', '01:00'));
  });

  it('local date of an instant near midnight', () => {
    expect(dateKeyOf(at(MON, '23:59'))).toBe(MON);
    expect(dateKeyOf(at(MON, '24:00'))).toBe('2026-11-17');
    // 16:59Z is still 23:59 local on Monday; 17:00Z is Tuesday local.
    expect(dateKeyOf(Date.parse('2026-11-16T16:59:00Z'))).toBe(MON);
    expect(dateKeyOf(Date.parse('2026-11-16T17:00:00Z'))).toBe('2026-11-17');
  });

  it('weekday and day arithmetic', () => {
    expect(weekdayOfKey(MON)).toBe(1);
    expect(weekdayOfKey('2026-11-22')).toBe(0);
    expect(addDaysToKey('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('dateKeysInRange is end-exclusive', () => {
    expect(dateKeysInRange(at(MON, '00:00'), at('2026-11-18', '00:00'))).toEqual([MON, '2026-11-17']);
    expect(dateKeysInRange(at(MON, '23:00'), at('2026-11-17', '01:00'))).toEqual([MON, '2026-11-17']);
    expect(dateKeysInRange(at(MON, '10:00'), at(MON, '10:00'))).toEqual([]);
  });

  it('formats ISO with +07:00 offset', () => {
    expect(toLocalIso(at(MON, '17:00'))).toBe('2026-11-16T17:00:00+07:00');
  });

  it('rejects invalid times', () => {
    expect(() => hhmmToMinutes('25:00')).toThrow();
    expect(() => hhmmToMinutes('8:00')).toThrow();
  });
});

describe('format', () => {
  it('Vietnamese day header', () => {
    expect(formatDayHeader(MON)).toBe('Thứ Hai, 16/11');
    expect(formatDayHeader('2026-11-22')).toBe('Chủ Nhật, 22/11');
  });

  it('durations', () => {
    expect(formatDurationCompact(320)).toBe('5g20');
    expect(formatDurationCompact(360)).toBe('6g');
    expect(formatDurationCompact(40)).toBe('40p');
    expect(formatDurationCompact(125)).toBe('2g05');
    expect(formatDurationLong(40)).toBe('40 phút');
    expect(formatDurationLong(120)).toBe('2 giờ');
    expect(formatDurationLong(150)).toBe('2 giờ 30 phút');
  });

  it('time range', () => {
    expect(formatTimeRange(at(MON, '19:00'), at(MON, '20:30'))).toBe('19:00–20:30');
  });

  it('countdown uses calendar days', () => {
    const now = at(MON, '22:00');
    expect(formatCountdown(at('2026-11-17', '08:00'), now)).toBe('Ngày mai');
    expect(formatCountdown(at('2026-11-18', '08:00'), now)).toBe('còn 2 ngày');
    expect(formatCountdown(at(MON, '23:30'), now)).toBe('còn 1 giờ');
    expect(formatCountdown(at(MON, '22:40'), now)).toBe('Hôm nay');
    expect(formatCountdown(at('2026-11-14', '08:00'), now)).toBe('Quá hạn 2 ngày');
  });
});
