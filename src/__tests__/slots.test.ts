import { allowedWindows, classOccurrences, computeFreeSlots, lunchBreaks, officeSpans, workWindows } from '../lib/time/slots';
import { type Interval, overlaps, totalMinutes } from '../lib/time/intervals';
import { at, ctx, FRI, MON, NEXT_TUE, SAT, SUN, THU, TUE } from './fixtures';

const on = (list: Interval[], key: string, from = '00:00', to = '24:00') =>
  list.filter((i) => overlaps(i, { start: at(key, from), end: at(key, to) }));

describe('work windows', () => {
  it('Monday: 08–12 and 13–17 (lunch excluded)', () => {
    expect(on(workWindows(ctx()), MON)).toEqual([
      { start: at(MON, '08:00'), end: at(MON, '12:00') },
      { start: at(MON, '13:00'), end: at(MON, '17:00') },
    ]);
  });

  it('no work windows on the weekend', () => {
    expect(on(workWindows(ctx()), SAT)).toEqual([]);
    expect(on(workWindows(ctx()), SUN)).toEqual([]);
  });

  it('disabled weekday has no office hours', () => {
    const c = ctx({ workHours: ctx().workHours.map((w) => (w.weekday === 5 ? { ...w, enabled: false } : w)) });
    expect(on(workWindows(c), FRI)).toEqual([]);
  });

  it('lunch break and office spans', () => {
    expect(on(lunchBreaks(ctx()), MON)).toEqual([{ start: at(MON, '12:00'), end: at(MON, '13:00') }]);
    expect(on(officeSpans(ctx()), MON)).toEqual([{ start: at(MON, '08:00'), end: at(MON, '17:00') }]);
  });

  it('work week totals 5 × 8h', () => {
    expect(totalMinutes(workWindows(ctx()))).toBe(5 * 8 * 60);
  });
});

describe('class occurrences + exceptions', () => {
  it('cancelled Tuesday class disappears, extra Thursday class appears', () => {
    const occ = classOccurrences(ctx());
    expect(occ.find((o) => o.date === TUE)).toBeUndefined();
    expect(occ.find((o) => o.date === THU)).toMatchObject({ start: at(THU, '19:30'), end: at(THU, '21:00'), kind: 'extra' });
    expect(occ.find((o) => o.date === SAT)).toMatchObject({ start: at(SAT, '08:00'), end: at(SAT, '11:00') });
  });

  it('regular class appears the following Tuesday', () => {
    const c = ctx({ range: { start: at(NEXT_TUE, '00:00'), end: at(NEXT_TUE, '24:00') } });
    expect(classOccurrences(c)).toHaveLength(1);
  });

  it('respects valid_from / valid_to', () => {
    const c = ctx({ classSessions: [{ id: 'x', weekday: 1, start: '09:00', end: '10:00', validFrom: '2026-12-01' }], exceptions: [] });
    expect(classOccurrences(c)).toHaveLength(0);
  });

  it('moved class: original removed, new time added', () => {
    const c = ctx({
      exceptions: [{ classSessionId: 'csdl-sat', date: SAT, type: 'moved', newStart: at(SUN, '14:00'), newEnd: at(SUN, '17:00') }],
    });
    const occ = classOccurrences(c);
    expect(occ.find((o) => o.start === at(SAT, '08:00'))).toBeUndefined();
    expect(occ.find((o) => o.kind === 'moved')).toMatchObject({ start: at(SUN, '14:00'), end: at(SUN, '17:00') });
  });
});

describe('free slots', () => {
  it('study on Tuesday (class cancelled) is the whole 19:00–22:30 window', () => {
    expect(on(computeFreeSlots(ctx()).study, TUE)).toEqual([{ start: at(TUE, '19:00'), end: at(TUE, '22:30') }]);
  });

  it('study on Thursday excludes the extra class', () => {
    expect(on(computeFreeSlots(ctx()).study, THU)).toEqual([
      { start: at(THU, '19:00'), end: at(THU, '19:30') },
      { start: at(THU, '21:00'), end: at(THU, '22:30') },
    ]);
  });

  it('study on Saturday excludes the morning class', () => {
    expect(on(computeFreeSlots(ctx()).study, SAT)).toEqual([{ start: at(SAT, '11:00'), end: at(SAT, '22:00') }]);
  });

  it('study never overlaps office hours, lunch included', () => {
    const c = ctx({ studyWindows: [{ weekday: 1, start: '07:00', end: '18:00' }] });
    expect(on(allowedWindows(c, 'study'), MON)).toEqual([
      { start: at(MON, '07:00'), end: at(MON, '08:00') },
      { start: at(MON, '17:00'), end: at(MON, '18:00') },
    ]);
  });

  it('Google busy events are subtracted from both spaces', () => {
    const busy = [
      { start: at(MON, '09:00'), end: at(MON, '10:30') },
      { start: at(MON, '20:00'), end: at(MON, '21:00') },
    ];
    const free = computeFreeSlots(ctx({ busy }));
    expect(on(free.work, MON, '08:00', '12:00')).toEqual([
      { start: at(MON, '08:00'), end: at(MON, '09:00') },
      { start: at(MON, '10:30'), end: at(MON, '12:00') },
    ]);
    expect(on(free.study, MON)).toEqual([
      { start: at(MON, '19:00'), end: at(MON, '20:00') },
      { start: at(MON, '21:00'), end: at(MON, '22:30') },
    ]);
  });

  it('time before now is never free', () => {
    const free = computeFreeSlots(ctx({ now: at(MON, '14:20') }));
    expect(on(free.work, MON)).toEqual([{ start: at(MON, '14:20'), end: at(MON, '17:00') }]);
  });

  it('midnight-crossing study window spans into the next day and respects quiet hours', () => {
    const c = ctx({
      studyWindows: [{ weekday: 5, start: '22:00', end: '01:00' }],
      quietHours: null,
    });
    expect(computeFreeSlots(c).study).toEqual([{ start: at(FRI, '22:00'), end: at(SAT, '01:00') }]);
    const quiet = computeFreeSlots({ ...c, quietHours: { start: '23:30', end: '06:00' } }).study;
    expect(quiet).toEqual([{ start: at(FRI, '22:00'), end: at(FRI, '23:30') }]);
  });

  it('Sunday-night window crossing into Monday is clipped to the range', () => {
    const c = ctx({
      range: { start: at(MON, '00:00'), end: at(MON, '24:00') },
      studyWindows: [{ weekday: 0, start: '22:00', end: '02:00' }],
      quietHours: null,
      now: undefined,
    });
    // The window that starts Sunday 22:00 contributes Monday 00:00–02:00.
    expect(computeFreeSlots(c).study).toEqual([{ start: at(MON, '00:00'), end: at(MON, '02:00') }]);
  });

  it('class during office hours blocks work time', () => {
    const c = ctx({ classSessions: [{ id: 'day', weekday: 3, start: '09:00', end: '10:00' }], exceptions: [] });
    const free = computeFreeSlots(c).work.filter((i) => overlaps(i, { start: at('2026-11-18', '08:00'), end: at('2026-11-18', '12:00') }));
    expect(free).toEqual([
      { start: at('2026-11-18', '08:00'), end: at('2026-11-18', '09:00') },
      { start: at('2026-11-18', '10:00'), end: at('2026-11-18', '12:00') },
    ]);
  });
});
