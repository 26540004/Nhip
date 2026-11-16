import { demoParse } from '../lib/api/demo/demoParse';

const NOW = Date.parse('2026-11-16T13:30:00+07:00');
const TZ = 'Asia/Ho_Chi_Minh';
const COLS = [
  { id: 'mang', name: 'Mạng máy tính', space: 'study' as const },
  { id: 'web', name: 'Website Kim Long', space: 'work' as const },
];

describe('demo (rule-based) Quick Add parsing', () => {
  it('single task with deadline and duration', () => {
    const r = demoParse('thứ 6 nộp báo cáo môn Mạng, mất khoảng 3 tiếng', COLS, NOW, TZ);
    // "…, mất khoảng 3 tiếng" has no verb of its own → it is the estimate of the same task.
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]).toMatchObject({
      title: 'Nộp báo cáo môn Mạng',
      space: 'study',
      collection_id: 'mang',
      deadline_at: '2026-11-20T23:59:00+07:00',
      estimate_minutes: 180,
    });
    expect(r.tasks[0]!.subtasks).toHaveLength(2);
  });

  it('two tasks in one sentence', () => {
    const r = demoParse('mai gọi khách hàng A, thứ 4 họp team 2h chiều', COLS, NOW, TZ);
    expect(r.tasks.map((t) => [t.title, t.deadline_at])).toEqual([
      ['Gọi khách hàng A', '2026-11-17T23:59:00+07:00'],
      ['Họp team', '2026-11-18T14:00:00+07:00'],
    ]);
  });

  it('duration in the same clause, subtasks over 2 hours', () => {
    const r = demoParse('ôn thi giữa kỳ mất 3 tiếng trước thứ 6 tuần sau', COLS, NOW, TZ);
    expect(r.tasks[0]).toMatchObject({
      title: 'Ôn thi giữa kỳ',
      estimate_minutes: 180,
      space: 'study',
      deadline_at: '2026-11-27T23:59:00+07:00',
    });
    expect(r.tasks[0]!.subtasks).toHaveLength(2);
  });

  it('keeps URLs aside', () => {
    const r = demoParse('đọc bài https://example.com/a tối nay', COLS, NOW, TZ);
    expect(r.url).toBe('https://example.com/a');
    expect(r.tasks[0]).toMatchObject({ title: 'Đọc bài', deadline_at: '2026-11-16T22:00:00+07:00' });
  });
});
