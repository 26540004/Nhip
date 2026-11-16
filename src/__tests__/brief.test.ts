import {
  type BriefBlock,
  type BriefTask,
  buildBrief,
  buildReview,
  dueNotifications,
  outOfQuiet,
  type ReminderSettings,
} from '../../supabase/functions/_shared/brief-core.ts';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso: string) => Date.parse(iso);

function task(p: Partial<BriefTask> & Pick<BriefTask, 'id'>): BriefTask {
  return {
    title: `Việc ${p.id}`,
    space: 'work',
    priority: 2,
    status: 'todo',
    deadline_at: null,
    estimate_minutes: 60,
    parent_task_id: null,
    created_at: '2026-11-01T00:00:00Z',
    ...p,
  };
}
const block = (id: string, task_id: string, s: string, e: string): BriefBlock => ({
  id,
  task_id,
  start_at: s,
  end_at: e,
  status: 'synced',
});

const settings: ReminderSettings = {
  morning_brief_time: '07:00:00',
  evening_review_time: '21:30:00',
  morning_brief_enabled: true,
  evening_review_enabled: true,
  deadline_offsets_minutes: [10080, 1440],
  quiet_start: '23:00:00',
  quiet_end: '06:30:00',
};

const tasks = [
  task({
    id: 'bc',
    title: 'Báo cáo môn Mạng',
    space: 'study',
    priority: 1,
    deadline_at: '2026-11-17T23:59:00+07:00',
    estimate_minutes: 180,
  }),
  task({ id: 'hop', title: 'Họp team', deadline_at: '2026-11-16T17:00:00+07:00' }),
  task({ id: 'done', status: 'done', completed_at: '2026-11-16T10:00:00+07:00' }),
];
const blocks = [
  block('b1', 'bc', '2026-11-16T19:00:00+07:00', '2026-11-16T20:00:00+07:00'),
  block('b2', 'bc', '2026-11-17T19:00:00+07:00', '2026-11-17T20:00:00+07:00'),
  block('b3', 'hop', '2026-11-16T14:00:00+07:00', '2026-11-16T15:00:00+07:00'),
];

describe('brief', () => {
  it('loads, top priorities and due-soon list with Vietnamese summary', () => {
    const b = buildBrief({ now: at('2026-11-16T07:00:00+07:00'), tz: TZ, tasks, blocks, capacity: [] });
    expect(b.loads).toEqual([
      { space: 'work', used: 60, max: 360 },
      { space: 'study', used: 60, max: 150 },
    ]);
    expect(b.top.map((t) => t.id)).toEqual(['bc', 'hop']); // high priority + due tomorrow beats normal priority due today
    expect(b.dueSoon.map((d) => [d.id, d.scheduledMinutes])).toEqual([
      ['hop', 60],
      ['bc', 120],
    ]);
    expect(b.summary).toBe(
      'Hôm nay có 2 việc trên lịch (Việc 1g/6g, Học 1g/2g30). Ưu tiên nhất: Báo cáo môn Mạng (Hạn ngày mai · Ưu tiên cao). 2 hạn chót trong 7 ngày tới.',
    );
  });

  it('flags overload', () => {
    const many = [block('x', 'hop', '2026-11-16T08:00:00+07:00', '2026-11-16T15:00:00+07:00')];
    const b = buildBrief({ now: at('2026-11-16T07:00:00+07:00'), tz: TZ, tasks, blocks: many, capacity: [] });
    expect(b.overloaded).toEqual([{ space: 'work', used: 420, max: 360 }]);
    expect(b.summary).toContain('Quá tải: Việc thừa 1 giờ');
  });
});

describe('evening review', () => {
  it("lists today's unfinished blocks and tasks due today", () => {
    const r = buildReview({ now: at('2026-11-16T21:30:00+07:00'), tz: TZ, tasks, blocks, capacity: [] });
    expect(r.items.map((i) => [i.taskId, i.blockIds, i.dueToday])).toEqual([
      ['bc', ['b1'], false],
      ['hop', ['b3'], true],
    ]);
    expect(r.doneToday.map((t) => t.id)).toEqual(['done']);
    expect(r.summary).toBe('Còn 2 việc chưa xong hôm nay, đã xong 1 việc. Chạm để xếp lại.');
  });
});

describe('dueNotifications', () => {
  const base = { tz: TZ, tasks, blocks, capacity: [], settings };

  it('morning brief at 07:00 within the lookback window, only once per window', () => {
    expect(dueNotifications({ ...base, now: at('2026-11-16T07:04:00+07:00') }).map((n) => n.key)).toEqual(['brief:2026-11-16']);
    expect(dueNotifications({ ...base, now: at('2026-11-16T06:59:00+07:00') })).toEqual([]);
    expect(dueNotifications({ ...base, now: at('2026-11-16T07:20:00+07:00') })).toEqual([]);
  });

  it('evening review with the unfinished count', () => {
    const n = dueNotifications({ ...base, now: at('2026-11-16T21:31:00+07:00') });
    expect(n).toEqual([expect.objectContaining({ key: 'review:2026-11-16', url: 'nhip://review' })]);
  });

  it('deadline reminder 1 day before, with estimate vs scheduled', () => {
    const n = dueNotifications({
      ...base,
      now: at('2026-11-16T23:59:00+07:00'),
      settings: { ...settings, quiet_start: null, quiet_end: null },
    });
    expect(n).toEqual([
      expect.objectContaining({
        key: 'deadline:bc:1440:2026-11-17T23:59:00+07:00',
        body: 'Còn 1 ngày: Báo cáo môn Mạng (ước tính 3 giờ, mới xếp được 2 giờ)',
        url: 'nhip://task/bc',
      }),
    ]);
  });

  it('quiet hours postpone a reminder to their end', () => {
    // 23:59 is inside 23:00–06:30 → delivered at 06:30 next morning.
    expect(dueNotifications({ ...base, now: at('2026-11-16T23:59:00+07:00') })).toEqual([]);
    const n = dueNotifications({ ...base, now: at('2026-11-17T06:31:00+07:00') });
    expect(n.map((x) => x.key)).toContain('deadline:bc:1440:2026-11-17T23:59:00+07:00');
    expect(outOfQuiet(at('2026-11-17T02:00:00+07:00'), { start: '23:00', end: '06:30' }, TZ)).toBe(at('2026-11-17T06:30:00+07:00'));
  });

  it('skips offsets before the task existed and finished tasks', () => {
    const fresh = [task({ id: 'new', deadline_at: '2026-11-20T10:00:00+07:00', created_at: '2026-11-16T00:00:00Z' })];
    // 7-day reminder would be 2026-11-13 — before creation.
    expect(dueNotifications({ ...base, tasks: fresh, now: at('2026-11-13T10:05:00+07:00') })).toEqual([]);
    expect(
      dueNotifications({
        ...base,
        tasks: [task({ id: 'd', status: 'done', deadline_at: '2026-11-17T10:00:00+07:00' })],
        now: at('2026-11-16T10:05:00+07:00'),
      }),
    ).toEqual([]);
  });
});
