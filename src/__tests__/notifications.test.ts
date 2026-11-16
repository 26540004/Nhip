import { type ReminderBlock, IOS_PENDING_LIMIT, desiredReminders, diffReminders, reminderId } from '../lib/notifications/local';
import { at, mins, MON, TUE } from './fixtures';

const mk = (i: number, start: number, extra: Partial<ReminderBlock> = {}): ReminderBlock => ({
  id: `b${i}`,
  taskId: `t${i}`,
  title: `Việc ${i}`,
  start,
  end: start + mins(60),
  status: 'synced',
  ...extra,
});

describe('local reminder scheduler', () => {
  const now = at(MON, '07:00');

  it('never schedules more than 50 (well under the iOS 64 cap), nearest first', () => {
    const blocks = Array.from({ length: 120 }, (_, i) => mk(i, at(MON, '08:00') + i * mins(90)));
    const r = desiredReminders(blocks, { now, offsetMinutes: 10 });
    expect(r).toHaveLength(50);
    expect(r.length).toBeLessThan(IOS_PENDING_LIMIT);
    expect(r[0]!.data.blockId).toBe('b0');
    for (let i = 1; i < r.length; i++) expect(r[i]!.fireAt).toBeGreaterThanOrEqual(r[i - 1]!.fireAt);
  });

  it('a limit above 64 is clamped', () => {
    const blocks = Array.from({ length: 100 }, (_, i) => mk(i, at(MON, '08:00') + i * mins(90)));
    expect(desiredReminders(blocks, { now, offsetMinutes: 10, limit: 500 })).toHaveLength(64);
  });

  it('fires offset minutes before start, Vietnamese copy', () => {
    const [r] = desiredReminders([mk(1, at(MON, '19:00'))], { now, offsetMinutes: 10 });
    expect(r!.fireAt).toBe(at(MON, '18:50'));
    expect(r!.title).toBe('Sắp bắt đầu: Việc 1');
    expect(r!.body).toBe('19:00–20:00 · còn 10 phút');
    expect(r!.data.url).toBe('nhip://task/t1');
  });

  it('skips past, proposed, rejected and done blocks', () => {
    const r = desiredReminders(
      [
        mk(1, at(MON, '06:00')),
        mk(2, at(MON, '09:00'), { status: 'proposed' }),
        mk(3, at(MON, '09:00'), { status: 'rejected' }),
        mk(4, at(MON, '09:00'), { taskDone: true }),
        mk(5, at(MON, '09:00'), { status: 'accepted' }),
      ],
      { now, offsetMinutes: 10 },
    );
    expect(r.map((x) => x.data.blockId)).toEqual(['b5']);
  });

  it('reminder inside quiet hours is moved to the end of quiet hours', () => {
    const [r] = desiredReminders([mk(1, at(TUE, '07:00'))], {
      now: at(MON, '20:00'),
      offsetMinutes: 30,
      quietHours: { start: '22:30', end: '06:45' },
    });
    expect(r!.fireAt).toBe(at(TUE, '06:45'));
    expect(r!.body).toContain('còn 15 phút');
  });

  it('block starting within the offset window still gets an immediate reminder', () => {
    const [r] = desiredReminders([mk(1, at(MON, '07:05'))], { now, offsetMinutes: 10 });
    expect(r!.fireAt).toBeGreaterThan(now);
    expect(r!.fireAt).toBeLessThan(at(MON, '07:05'));
  });

  it('diff cancels stale/moved and schedules only new', () => {
    const moved = mk(1, at(MON, '10:00'));
    const desired = desiredReminders([moved, mk(2, at(MON, '11:00'))], { now, offsetMinutes: 10 });
    const scheduled = [
      { id: reminderId({ id: 'b1', start: at(MON, '09:00') }) },
      { id: reminderId(mk(2, at(MON, '11:00'))) },
      { id: 'legacy' },
    ];
    const d = diffReminders(scheduled, desired);
    expect(d.cancel.sort()).toEqual([reminderId({ id: 'b1', start: at(MON, '09:00') }), 'legacy'].sort());
    expect(d.schedule.map((s) => s.data.blockId)).toEqual(['b1']);
  });
});
