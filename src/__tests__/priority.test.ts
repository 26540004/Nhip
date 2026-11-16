import { rankTasks, scoreTask } from '../lib/planning/priority';
import { at, MON, TUE, WED } from './fixtures';

const now = at(MON, '09:00');
const base = { title: 't', remainingMinutes: 60, createdAt: 0 };

describe('priority', () => {
  it('overdue beats everything and says so', () => {
    const r = scoreTask({ ...base, id: 'a', priority: 3, deadlineAt: at('2026-11-15', '17:00') }, now);
    expect(r.reason).toContain('Đã quá hạn');
  });

  it('ranks overdue > due tomorrow high > due in 2 days > no deadline', () => {
    const ranked = rankTasks(
      [
        { ...base, id: 'none', priority: 1, deadlineAt: null },
        { ...base, id: 'wed', priority: 2, deadlineAt: at(WED, '17:00') },
        { ...base, id: 'tue', priority: 1, deadlineAt: at(TUE, '17:00') },
        { ...base, id: 'late', priority: 3, deadlineAt: at('2026-11-14', '17:00') },
      ],
      now,
    );
    expect(ranked.map((r) => r.id)).toEqual(['late', 'tue', 'wed', 'none']);
  });

  it('reason is one line with at most two parts', () => {
    const r = scoreTask(
      { ...base, id: 'x', priority: 1, deadlineAt: at(TUE, '17:00'), remainingMinutes: 240, freeMinutesBeforeDeadline: 300 },
      now,
    );
    expect(r.reason.split(' · ').length).toBeLessThanOrEqual(2);
    expect(r.reason).not.toContain('\n');
    expect(r.reason).toContain('Hạn ngày mai');
  });

  it('ties broken by earlier deadline, then older task', () => {
    const ranked = rankTasks(
      [
        { ...base, id: 'b', priority: 2, deadlineAt: null, createdAt: 2 },
        { ...base, id: 'a', priority: 2, deadlineAt: null, createdAt: 1 },
      ],
      now,
    );
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
