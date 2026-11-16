/**
 * Vietnamese parsing fixtures. "Now" is Monday 16/11/2026 13:30 in Asia/Ho_Chi_Minh.
 * Covers spec §I.1: mai, mốt, thứ 6 này, thứ 6 tuần sau, cuối tuần, đầu tháng sau,
 * trước 5h chiều, tối nay — plus durations, collections and space inference.
 */
import {
  guessSpace,
  matchCollection,
  normalizeVi,
  parseDurationMinutes,
  resolveDeadline,
} from '../../supabase/functions/_shared/vi-parse.ts';

const TZ = 'Asia/Ho_Chi_Minh';
const NOW = Date.parse('2026-11-16T13:30:00+07:00');

const deadlineFixtures: [string, string][] = [
  ['mai', '2026-11-17T23:59:00+07:00'],
  ['ngày mai', '2026-11-17T23:59:00+07:00'],
  ['mốt', '2026-11-18T23:59:00+07:00'],
  ['ngày kia', '2026-11-18T23:59:00+07:00'],
  ['hôm nay', '2026-11-16T23:59:00+07:00'],
  ['thứ 6 này', '2026-11-20T23:59:00+07:00'],
  ['thứ 6', '2026-11-20T23:59:00+07:00'],
  ['thứ sáu', '2026-11-20T23:59:00+07:00'],
  ['t7', '2026-11-21T23:59:00+07:00'],
  ['thứ 2', '2026-11-16T23:59:00+07:00'],
  ['thứ 6 tuần sau', '2026-11-27T23:59:00+07:00'],
  ['thứ hai tuần tới', '2026-11-23T23:59:00+07:00'],
  ['chủ nhật', '2026-11-22T23:59:00+07:00'],
  ['cuối tuần', '2026-11-22T23:59:00+07:00'],
  ['cuối tuần sau', '2026-11-29T23:59:00+07:00'],
  ['tuần sau', '2026-11-29T23:59:00+07:00'],
  ['đầu tháng sau', '2026-12-01T23:59:00+07:00'],
  ['cuối tháng', '2026-11-30T23:59:00+07:00'],
  ['trước 5h chiều', '2026-11-16T17:00:00+07:00'],
  ['trước 5h chiều mai', '2026-11-17T17:00:00+07:00'],
  ['tối nay', '2026-11-16T22:00:00+07:00'],
  ['sáng mai', '2026-11-17T12:00:00+07:00'],
  ['thứ 4 2h chiều', '2026-11-18T14:00:00+07:00'],
  ['2h', '2026-11-16T14:00:00+07:00'],
  ['9h sáng', '2026-11-17T09:00:00+07:00'], // already past today → tomorrow
  ['17:30 thứ 5', '2026-11-19T17:30:00+07:00'],
  ['5 rưỡi chiều nay', '2026-11-16T17:30:00+07:00'],
  ['9h tối thứ 7', '2026-11-21T21:00:00+07:00'],
  ['20/11', '2026-11-20T23:59:00+07:00'],
  ['5/1', '2027-01-05T23:59:00+07:00'],
  ['ngày 25', '2026-11-25T23:59:00+07:00'],
  ['ngày 5 tháng 12', '2026-12-05T23:59:00+07:00'],
  ['3 ngày nữa', '2026-11-19T23:59:00+07:00'],
  ['THỨ 6 NÀY', '2026-11-20T23:59:00+07:00'],
];

describe('resolveDeadline — Vietnamese relative dates', () => {
  it.each(deadlineFixtures)('"%s" → %s', (phrase, expected) => {
    expect(resolveDeadline(phrase, NOW, TZ)?.iso).toBe(expected);
  });

  it('has at least 20 fixtures', () => {
    expect(deadlineFixtures.length).toBeGreaterThanOrEqual(20);
  });

  it('returns null when there is no date or time', () => {
    expect(resolveDeadline('gọi khách hàng A', NOW, TZ)).toBeNull();
    expect(resolveDeadline('', NOW, TZ)).toBeNull();
  });

  it('"một" (one) is not mistaken for "mốt"', () => {
    expect(resolveDeadline('một tiếng', NOW, TZ)).toBeNull();
  });

  it('crossing the year boundary', () => {
    const dec31 = Date.parse('2026-12-31T10:00:00+07:00');
    expect(resolveDeadline('mai', dec31, TZ)?.iso).toBe('2027-01-01T23:59:00+07:00');
    expect(resolveDeadline('đầu tháng sau', dec31, TZ)?.iso).toBe('2027-01-01T23:59:00+07:00');
  });

  it('late-night "now" uses the local date, not UTC', () => {
    // 23:30 local Monday = 16:30Z Monday; at 00:30 local Tuesday UTC is still Monday.
    const tueEarly = Date.parse('2026-11-17T00:30:00+07:00');
    expect(resolveDeadline('mai', tueEarly, TZ)?.iso).toBe('2026-11-18T23:59:00+07:00');
  });
});

describe('parseDurationMinutes', () => {
  it.each([
    ['khoảng 3 tiếng', 180],
    ['mất khoảng 3 tiếng', 180],
    ['45 phút', 45],
    ['1 tiếng rưỡi', 90],
    ['một tiếng rưỡi', 90],
    ['1h30', 90],
    ['2 tiếng 15 phút', 135],
    ['nửa tiếng', 30],
    ['2h', 120],
    ['1.5 giờ', 90],
    ['90 phút', 90],
  ] as [string, number][])('"%s" → %i', (phrase, minutes) => {
    expect(parseDurationMinutes(phrase)).toBe(minutes);
  });

  it('null when there is no duration', () => {
    expect(parseDurationMinutes('sớm')).toBeNull();
  });
});

describe('collections & space', () => {
  const cols = [
    { id: 'c1', name: 'Mạng máy tính', space: 'study' as const },
    { id: 'c2', name: 'Cơ sở dữ liệu', space: 'study' as const },
    { id: 'p1', name: 'Website Kim Long', space: 'work' as const },
  ];

  it('normalizes diacritics and đ', () => {
    expect(normalizeVi('  Đồ ÁN  Mạng ')).toBe('do an mang');
  });

  it('matches a subject by a distinctive word', () => {
    expect(matchCollection('Nộp báo cáo môn Mạng', cols)?.id).toBe('c1');
  });

  it('uses the AI hint when given', () => {
    expect(matchCollection('Làm bài tập', cols, 'Cơ sở dữ liệu')?.id).toBe('c2');
  });

  it('no match → null', () => {
    expect(matchCollection('Đi chợ', cols)).toBeNull();
  });

  it('keyword space guess', () => {
    expect(guessSpace('Ôn thi giữa kỳ')).toBe('study');
    expect(guessSpace('Họp team dự án')).toBe('work');
    expect(guessSpace('Mua quà sinh nhật')).toBeNull();
  });
});
