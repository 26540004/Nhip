import { usageByDay } from '../lib/planning/capacity';
import type { PlacedBlock, PlanTask } from '../lib/planning/engine';
import { greedyPlan, splitMinutes } from '../lib/planning/greedyPlan';
import { type ProposedBlock, validatePlan } from '../lib/planning/validatePlan';
import { type Interval, contains, overlaps } from '../lib/time/intervals';
import { allowedWindows, classOccurrences, lunchBreaks, officeSpans, type SlotContext } from '../lib/time/slots';
import { MINUTE, dateKeyOf } from '../lib/time/tz';
import { at, capacity, ctx, FRI, mins, MON, rng, SAT, task, THU, TUE, WED } from './fixtures';

const block = (taskId: string, start: number, minutes: number): ProposedBlock => ({ taskId, start, end: start + mins(minutes) });

function run(tasks: PlanTask[], proposed: ProposedBlock[], extra: { ctx?: SlotContext; existing?: PlacedBlock[] } = {}) {
  return validatePlan({ ctx: extra.ctx ?? ctx(), capacity, existingBlocks: extra.existing ?? [], tasks, proposed });
}

describe('validatePlan — accepts valid blocks unchanged', () => {
  it('work block inside office hours', () => {
    const r = run([task({ id: 'w' })], [block('w', at(MON, '08:00'), 60)]);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ start: at(MON, '08:00'), repaired: false, issues: [] });
    expect(r.warnings).toEqual([]);
  });

  it('study block in an evening window', () => {
    const r = run([task({ id: 's', space: 'study' })], [block('s', at(TUE, '19:00'), 60)]);
    expect(r.blocks[0]).toMatchObject({ repaired: false });
  });
});

describe('validatePlan — repairs', () => {
  it('work block during lunch is moved out of lunch', () => {
    const r = run([task({ id: 'w' })], [block('w', at(MON, '12:00'), 45)]);
    const b = r.blocks[0]!;
    expect(b.repaired).toBe(true);
    expect(b.issues).toContain('outside_window');
    expect(overlaps(b, { start: at(MON, '12:00'), end: at(MON, '13:00') })).toBe(false);
    expect(r.warnings.some((w) => w.kind === 'repaired')).toBe(true);
  });

  it('work block in the evening is moved into office hours', () => {
    const r = run([task({ id: 'w' })], [block('w', at(MON, '19:00'), 60)]);
    const b = r.blocks[0]!;
    expect(b.issues).toContain('outside_window');
    expect(b.start).toBe(at(MON, '16:00')); // nearest valid slot to 19:00
  });

  it('study block overlapping a class is moved', () => {
    const r = run([task({ id: 's', space: 'study' })], [block('s', at(THU, '19:30'), 60)]);
    const b = r.blocks[0]!;
    expect(b.issues).toContain('overlap');
    expect(overlaps(b, { start: at(THU, '19:30'), end: at(THU, '21:00') })).toBe(false);
  });

  it('blocks longer than 90 min are trimmed', () => {
    const r = run([task({ id: 'w', remainingMinutes: 300 })], [block('w', at(MON, '08:00'), 150)]);
    expect(r.blocks[0]).toMatchObject({ start: at(MON, '08:00'), end: at(MON, '09:30'), repaired: true });
    expect(r.blocks[0]!.issues).toContain('too_long');
  });

  it('enforces 10-minute buffer between blocks', () => {
    const r = run(
      [task({ id: 'a' }), task({ id: 'b' })],
      [block('a', at(MON, '08:00'), 60), block('b', at(MON, '09:00'), 60)],
    );
    const b = r.blocks.find((x) => x.taskId === 'b')!;
    expect(b.repaired).toBe(true);
    expect(b.start - r.blocks[0]!.end).toBeGreaterThanOrEqual(10 * MINUTE);
  });

  it('buffer also applies around Google busy events', () => {
    const c = ctx({ busy: [{ start: at(MON, '09:00'), end: at(MON, '10:00') }] });
    const r = run([task({ id: 'a' })], [block('a', at(MON, '10:00'), 60)], { ctx: c });
    expect(r.blocks[0]!.start).toBeGreaterThanOrEqual(at(MON, '10:10'));
  });

  it('block ending after the deadline is moved before it', () => {
    const r = run([task({ id: 'w', deadlineAt: at(TUE, '10:00') })], [block('w', at(TUE, '13:00'), 60)]);
    const b = r.blocks[0]!;
    expect(b.issues).toContain('after_deadline');
    expect(b.end).toBeLessThanOrEqual(at(TUE, '10:00'));
  });

  it('caps total at remaining minutes', () => {
    const r = run(
      [task({ id: 'w', remainingMinutes: 90 })],
      [block('w', at(MON, '08:00'), 60), block('w', at(MON, '10:00'), 60), block('w', at(MON, '14:00'), 60)],
    );
    const total = r.blocks.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    expect(total).toBe(90);
    expect(r.dropped.map((d) => d.issues)).toContainEqual(['exceeds_remaining']);
  });

  it('respects daily capacity by moving the excess to another day', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `t${i}`, remainingMinutes: 90 }));
    // 5 × 90 = 450 min on Monday > 360 capacity.
    const starts = ['08:00', '09:40', '13:00', '14:40', '16:20'];
    const proposed = tasks.map((t, i) => block(t.id, at(MON, starts[i]!), i === 4 ? 40 : 90));
    const r = run(tasks, proposed);
    const usage = usageByDay(r.blocks);
    for (const u of usage.values()) expect(u.work).toBeLessThanOrEqual(360);
    expect(r.blocks.some((b) => dateKeyOf(b.start) !== MON)).toBe(true);
  });

  it('max 3 consecutive focus hours', () => {
    const c = ctx();
    const tasks = ['a', 'b', 'c'].map((id) => task({ id, remainingMinutes: 90 }));
    // 3 × 80 min with only 10-min gaps → 4h continuous; third must move.
    const r = run(tasks, [block('a', at(MON, '08:00'), 80), block('b', at(MON, '09:30'), 80), block('c', at(MON, '13:00'), 80)], { ctx: c });
    const proposed = run(
      tasks,
      [block('a', at(MON, '13:00'), 80), block('b', at(MON, '14:30'), 80), block('c', at(MON, '16:00'), 60)],
      { ctx: c },
    );
    expect(r.blocks.every((b) => !b.repaired)).toBe(true); // 08:00–10:50 = 160 min chain, then lunch gap
    const third = proposed.blocks.find((b) => b.taskId === 'c')!;
    expect(third.repaired).toBe(true);
    expect(third.issues).toContain('too_many_consecutive');
  });
});

describe('validatePlan — drops and warnings', () => {
  it('drops blocks for unknown tasks', () => {
    const r = run([], [block('ghost', at(MON, '08:00'), 60)]);
    expect(r.blocks).toEqual([]);
    expect(r.dropped[0]!.issues).toEqual(['unknown_task']);
  });

  it('drops a block when no valid slot exists, with a warning', () => {
    const c = ctx({ range: { start: at(MON, '00:00'), end: at(MON, '24:00') }, busy: [{ start: at(MON, '08:00'), end: at(MON, '17:00') }] });
    const r = run([task({ id: 'w' })], [block('w', at(MON, '09:00'), 60)], { ctx: c });
    expect(r.blocks).toEqual([]);
    expect(r.warnings.map((w) => w.kind)).toContain('dropped');
  });

  it('deadline that cannot fit produces a cannot_fit warning with the shortfall', () => {
    // Due Tue 10:00. Available: Mon 08–12, 13–17 capped at 360, + Tue 08:00–10:00 (= 120) → 480 max.
    const t = task({ id: 'big', title: 'Đồ án', remainingMinutes: 600, deadlineAt: at(TUE, '10:00') });
    const r = run([t], []);
    const w = r.warnings.find((x) => x.kind === 'cannot_fit');
    expect(w).toMatchObject({ taskId: 'big', shortfallMinutes: 120 });
    expect(w!.message).toBe("Không đủ thời gian cho 'Đồ án' trước hạn — cần thêm 2 giờ");
  });

  it('task left partially unscheduled gets a partial warning, not a silent drop', () => {
    const r = run([task({ id: 'w', title: 'Báo cáo', remainingMinutes: 120 })], [block('w', at(MON, '08:00'), 60)]);
    expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'partial', unscheduledMinutes: 60 }));
  });

  it('reports overload from existing blocks deterministically', () => {
    const existing: PlacedBlock[] = [
      { taskId: 'x', space: 'work', start: at(MON, '08:00'), end: at(MON, '12:00') },
      { taskId: 'y', space: 'work', start: at(MON, '13:00'), end: at(MON, '15:40') },
    ];
    const r = run([], [], { existing });
    expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'overload', date: MON, space: 'work', overMinutes: 40 }));
  });
});

describe('splitMinutes', () => {
  it.each([
    [60, [60]],
    [90, [90]],
    [180, [90, 90]],
    [200, [60, 60, 80]],
    [100, [45, 55]],
    [270, [90, 90, 90]],
  ])('%i → %j', (total, expected) => {
    const parts = splitMinutes(total);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(parts).toEqual(expected);
    for (const p of parts) expect(p).toBeLessThanOrEqual(90);
  });
});

describe('greedyPlan → validatePlan (property test on seed-like data)', () => {
  function invariants(c: SlotContext, blocks: { space: 'work' | 'study'; start: number; end: number }[]) {
    const work = allowedWindows(c, 'work');
    const study = allowedWindows(c, 'study');
    const lunch = lunchBreaks(c);
    const office = officeSpans(c);
    const classes: Interval[] = classOccurrences(c);
    for (const b of blocks) {
      if (b.space === 'work') {
        expect(work.some((w) => contains(w, b))).toBe(true);
        expect(lunch.some((l) => overlaps(l, b))).toBe(false);
      } else {
        expect(study.some((w) => contains(w, b))).toBe(true);
        expect(office.some((o) => overlaps(o, b))).toBe(false);
      }
      expect(classes.some((cl) => overlaps(cl, b))).toBe(false);
      expect(b.end - b.start).toBeLessThanOrEqual(90 * MINUTE);
    }
    const sorted = [...blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.start - sorted[i - 1]!.end).toBeGreaterThanOrEqual(10 * MINUTE);
    }
    for (const u of usageByDay(blocks).values()) {
      expect(u.work).toBeLessThanOrEqual(360);
      expect(u.study).toBeLessThanOrEqual(300);
    }
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: greedy output is valid and survives validation unchanged', (seed) => {
    const rand = rng(seed);
    const days = [MON, TUE, WED, THU, FRI, SAT];
    const c = ctx({
      busy: [
        { start: at(TUE, '10:00'), end: at(TUE, '11:30') },
        { start: at(WED, '20:00'), end: at(WED, '21:00') },
      ],
    });
    const tasks: PlanTask[] = Array.from({ length: 12 }, (_, i) => {
      const space = rand() < 0.5 ? 'work' : 'study';
      const day = days[Math.floor(rand() * days.length)]!;
      return task({
        id: `t${i}`,
        space,
        priority: (1 + Math.floor(rand() * 3)) as 1 | 2 | 3,
        remainingMinutes: 30 + Math.floor(rand() * 10) * 30,
        deadlineAt: rand() < 0.8 ? at(day, '22:00') : null,
        createdAt: i,
      });
    });

    const plan = greedyPlan({ ctx: c, capacity, existingBlocks: [], tasks });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    invariants(c, plan.blocks.map((b) => ({ ...b, space: byId.get(b.taskId)!.space })));

    const report = validatePlan({ ctx: c, capacity, existingBlocks: [], tasks, proposed: plan.blocks });
    expect(report.dropped).toEqual([]);
    expect(report.blocks.every((b) => !b.repaired)).toBe(true);
    expect(report.blocks).toHaveLength(plan.blocks.length);
    // Every task that could not be fully placed is reported, never silently dropped.
    for (const id of plan.unplaced) {
      expect(report.warnings.some((w) => 'taskId' in w && w.taskId === id && (w.kind === 'cannot_fit' || w.kind === 'partial'))).toBe(true);
    }
  });

  it('validation of random (bad) proposals always yields valid blocks', () => {
    const rand = rng(42);
    const c = ctx();
    const tasks: PlanTask[] = Array.from({ length: 8 }, (_, i) =>
      task({ id: `r${i}`, space: i % 2 ? 'study' : 'work', remainingMinutes: 120, deadlineAt: at(SAT, '20:00') }),
    );
    const proposed: ProposedBlock[] = Array.from({ length: 30 }, () => {
      const t = tasks[Math.floor(rand() * tasks.length)]!;
      const start = c.range.start + Math.floor(rand() * 7 * 24 * 4) * 15 * MINUTE;
      return block(t.id, start, 30 + Math.floor(rand() * 6) * 15);
    });
    const report = validatePlan({ ctx: c, capacity, existingBlocks: [], tasks, proposed });
    invariants(c, report.blocks);
    for (const b of report.blocks) expect(b.end).toBeLessThanOrEqual(at(SAT, '20:00'));
  });

  it('long tasks are spread across days', () => {
    const t = task({ id: 'long', space: 'study', remainingMinutes: 240, deadlineAt: at(FRI, '22:00') });
    const plan = greedyPlan({ ctx: ctx(), capacity, existingBlocks: [], tasks: [t] });
    const days = new Set(plan.blocks.map((b) => dateKeyOf(b.start)));
    expect(days.size).toBe(plan.blocks.length);
    // Backward planning: finish ≥ 1 day before deadline when possible.
    expect(Math.max(...plan.blocks.map((b) => b.end))).toBeLessThanOrEqual(at(THU, '22:00'));
  });
});
