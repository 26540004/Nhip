/**
 * propose-plan pipeline: context building, AI output mapping/validation/top-up, greedy
 * fallback, "Xếp lịch việc này", "Cân bằng lại" — with the spec §N invariants checked on
 * every outcome (work only in office hours outside lunch; study never on classes/office hours).
 */
import {
  AiPlanResponse,
  buildPlanContext,
  buildPlanPrompt,
  finalizePlan,
  type PlanInputs,
  type TaskRow,
} from '../../supabase/functions/_shared/propose-plan-core.ts';
import { usageByDay } from '../lib/planning/capacity';
import { contains, overlaps } from '../lib/time/intervals';
import { allowedWindows, classOccurrences, lunchBreaks, officeSpans } from '../lib/time/slots';
import { MINUTE } from '../lib/time/tz';
import { at, classSessions, exceptions, FRI, MON, studyWindows, TUE, WED, workHours } from './fixtures';

const NOW = at(MON, '07:30');

function row(p: Partial<TaskRow> & Pick<TaskRow, 'id'>): TaskRow {
  return {
    parent_task_id: null,
    title: `Việc ${p.id}`,
    space: 'work',
    deadline_at: null,
    estimate_minutes: 60,
    priority: 2,
    status: 'todo',
    created_at: '2026-11-01T00:00:00Z',
    ...p,
  };
}

function inputs(over: Partial<PlanInputs> = {}): PlanInputs {
  return {
    now: NOW,
    tz: 'Asia/Ho_Chi_Minh',
    request: { range: 'week' },
    tasks: [
      row({
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Báo cáo môn Mạng',
        space: 'study',
        estimate_minutes: 180,
        priority: 1,
        deadline_at: new Date(at(FRI, '23:59')).toISOString(),
      }),
      row({
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Sửa banner',
        space: 'work',
        estimate_minutes: 90,
        priority: 1,
        deadline_at: new Date(at(TUE, '17:00')).toISOString(),
      }),
      row({ id: '00000000-0000-4000-8000-000000000003', title: 'Gửi báo giá', space: 'work', estimate_minutes: null }),
    ],
    blocks: [],
    busy: [{ start: at(MON, '09:00'), end: at(MON, '10:00') }],
    rules: { workHours, studyWindows, classSessions, exceptions, quietHours: { start: '23:00', end: '06:30' } },
    capacity: [],
    privacyMode: false,
    ...over,
  };
}

function assertInvariants(input: PlanInputs, blocks: { start: number; end: number; space: 'study' | 'work' }[]) {
  const pc = buildPlanContext(input);
  const work = allowedWindows(pc.ctx, 'work');
  const study = allowedWindows(pc.ctx, 'study');
  const lunch = lunchBreaks(pc.ctx);
  const office = officeSpans(pc.ctx);
  const classes = classOccurrences(pc.ctx);
  for (const b of blocks) {
    if (b.space === 'work') {
      expect(work.some((w) => contains(w, b))).toBe(true);
      expect(lunch.some((l) => overlaps(l, b))).toBe(false);
    } else {
      expect(study.some((w) => contains(w, b))).toBe(true);
      expect(office.some((o) => overlaps(o, b))).toBe(false);
      expect(classes.some((c) => overlaps(c, b))).toBe(false);
    }
    expect(input.busy.some((x) => overlaps(x, b))).toBe(false);
    expect(b.end - b.start).toBeLessThanOrEqual(90 * MINUTE);
  }
  for (const u of usageByDay(blocks).values()) expect(u.work).toBeLessThanOrEqual(360);
}

describe('buildPlanContext', () => {
  it('computes remaining minutes, default estimate and aliases', () => {
    const pc = buildPlanContext(
      inputs({
        blocks: [
          {
            id: 'b1',
            task_id: '00000000-0000-4000-8000-000000000001',
            start_at: new Date(at(MON, '19:00')).toISOString(),
            end_at: new Date(at(MON, '20:00')).toISOString(),
            status: 'synced',
          },
        ],
      }),
    );
    const t1 = pc.tasks.find((t) => t.id.endsWith('1'))!;
    expect(t1.remainingMinutes).toBe(120);
    expect(pc.tasks.find((t) => t.id.endsWith('3'))!.remainingMinutes).toBe(60);
    expect([...pc.alias.keys()]).toEqual(['T1', 'T2', 'T3']);
    expect(pc.existing).toHaveLength(1);
  });

  it('plans open subtasks instead of their parent', () => {
    const parent = '00000000-0000-4000-8000-0000000000aa';
    const pc = buildPlanContext(
      inputs({
        tasks: [
          row({ id: parent, title: 'Đồ án', space: 'study', estimate_minutes: 300 }),
          row({
            id: '00000000-0000-4000-8000-0000000000ab',
            parent_task_id: parent,
            title: 'Viết báo cáo',
            space: 'study',
            estimate_minutes: 90,
          }),
        ],
      }),
    );
    expect(pc.tasks.map((t) => t.title)).toEqual(['Đồ án › Viết báo cáo']);
  });

  it('"Xếp lịch việc này" restricts to the given task', () => {
    const pc = buildPlanContext(inputs({ request: { range: 'today', task_ids: ['00000000-0000-4000-8000-000000000002'] } }));
    expect(pc.tasks.map((t) => t.id)).toEqual(['00000000-0000-4000-8000-000000000002']);
  });

  it('privacy mode truncates titles to 60 characters and sends no notes', () => {
    const long = 'A'.repeat(100);
    const input = inputs({ privacyMode: true, tasks: [row({ id: '00000000-0000-4000-8000-000000000009', title: long })] });
    const p = buildPlanPrompt(buildPlanContext(input), input);
    const payload = JSON.parse(p.user) as { tasks: { title: string }[] };
    expect(payload.tasks[0]!.title).toHaveLength(60);
    expect(p.user).not.toContain('description');
  });
});

describe('finalizePlan', () => {
  it('maps AI output, repairs invalid blocks (lunch, evening work, class overlap) and keeps reasons', () => {
    const input = inputs();
    const pc = buildPlanContext(input);
    const ai = AiPlanResponse.parse({
      summary: 'Tuần này có 2 deadline.',
      blocks: [
        { task: pc.aliasOf.get('00000000-0000-4000-8000-000000000002'), start: `${MON}T12:00`, end: `${MON}T13:30`, reason: 'Hạn thứ 3' }, // lunch
        {
          task: pc.aliasOf.get('00000000-0000-4000-8000-000000000001'),
          start: `${MON}T19:00`,
          end: `${MON}T20:30`,
          reason: 'Buổi tối trống',
        }, // class 18:00–20:30? Monday has none in fixtures
        { task: pc.aliasOf.get('00000000-0000-4000-8000-000000000003'), start: `${MON}T20:00`, end: `${MON}T21:00`, reason: 'x' }, // work at night
        { task: 'T99', start: `${MON}T08:00`, end: `${MON}T09:00`, reason: 'ghost' },
      ],
    });
    const out = finalizePlan(pc, ai, input.capacity);
    expect(out.source).toBe('ai');
    expect(out.summary).toBe('Tuần này có 2 deadline.');
    assertInvariants(input, out.blocks);
    expect(out.stats.repaired).toBeGreaterThanOrEqual(2);
    // Top-up placed the rest of the 180-minute report somewhere valid.
    const report = out.blocks.filter((b) => b.taskId.endsWith('1')).reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    expect(report).toBe(180);
  });

  it('AI unavailable → greedy fallback produces a complete valid plan with a deterministic summary', () => {
    const input = inputs();
    const out = finalizePlan(buildPlanContext(input), null, input.capacity);
    expect(out.source).toBe('fallback');
    expect(out.summary).toMatch(/^Đã xếp \d+ khối cho 3 việc/);
    assertInvariants(input, out.blocks);
    const total = out.blocks.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    expect(total).toBe(180 + 90 + 60);
  });

  it('overdue tasks go first and say why', () => {
    const input = inputs({
      tasks: [
        row({
          id: '00000000-0000-4000-8000-000000000011',
          title: 'Sau',
          space: 'work',
          estimate_minutes: 60,
          deadline_at: new Date(at(FRI, '17:00')).toISOString(),
        }),
        row({
          id: '00000000-0000-4000-8000-000000000012',
          title: 'Quá hạn',
          space: 'work',
          estimate_minutes: 60,
          deadline_at: new Date(at(MON, '07:00')).toISOString(),
        }),
      ],
      busy: [],
    });
    const out = finalizePlan(buildPlanContext(input), null, input.capacity);
    expect(out.blocks[0]!.taskId).toBe('00000000-0000-4000-8000-000000000012');
    expect(out.blocks[0]!.reason).toContain('Đã quá hạn');
  });

  it('deadline that cannot fit → clear warning instead of a silent drop', () => {
    const input = inputs({
      request: { range: 'today' },
      tasks: [
        row({
          id: '00000000-0000-4000-8000-000000000007',
          title: 'Đồ án',
          space: 'work',
          estimate_minutes: 900,
          deadline_at: new Date(at(MON, '17:00')).toISOString(),
        }),
      ],
    });
    const out = finalizePlan(buildPlanContext(input), null, input.capacity);
    const w = out.warnings.find((x) => x.kind === 'cannot_fit');
    expect(w?.message).toMatch(/^Không đủ thời gian cho 'Đồ án' trước hạn — cần thêm/);
  });

  it('"Cân bằng lại" releases the overloaded day and re-plans within capacity', () => {
    const t = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
    const tasks = [1, 2, 3, 4, 5].map((n) => row({ id: t(n), title: `Việc ${n}`, space: 'work', estimate_minutes: 90 }));
    // 5 × 90 = 450 minutes of work on Tuesday (capacity 360).
    const starts = ['08:00', '09:40', '13:00', '14:40', '16:20'];
    const blocks = tasks.map((x, i) => ({
      id: `b${i}`,
      task_id: x.id,
      start_at: new Date(at(TUE, starts[i]!)).toISOString(),
      end_at: new Date(at(TUE, starts[i]!) + (i === 4 ? 40 : 90) * MINUTE).toISOString(),
      status: 'synced',
    }));
    const input = inputs({ now: at(MON, '20:00'), tasks, blocks, busy: [], request: { range: 'today', rebalance_date: TUE } });
    const pc = buildPlanContext(input);
    expect(pc.replaces).toHaveLength(5);
    const out = finalizePlan(pc, null, input.capacity);
    assertInvariants(input, out.blocks);
    const tue = usageByDay(out.blocks).get(TUE);
    expect(tue?.work ?? 0).toBeLessThanOrEqual(360);
    expect(out.blocks.some((b) => b.start >= at(WED, '00:00'))).toBe(true);
  });
});
