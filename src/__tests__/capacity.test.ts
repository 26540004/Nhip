import { capacityFor, computeLoads, dayLoad, usageByDay } from '../lib/planning/capacity';
import { at, MON, SAT, TUE } from './fixtures';

describe('capacity', () => {
  it('defaults and overrides', () => {
    expect(capacityFor([], 'work', 1)).toBe(360);
    expect(capacityFor([], 'study', 1)).toBe(150);
    expect(capacityFor([], 'work', 6)).toBe(0);
    expect(capacityFor([{ space: 'study', weekday: 1, maxFocusMinutes: 120 }], 'study', 1)).toBe(120);
  });

  it('splits a block across midnight', () => {
    const usage = usageByDay([{ space: 'study', start: at(MON, '23:00'), end: at(TUE, '00:30') }]);
    expect(usage.get(MON)).toEqual({ study: 60, work: 0 });
    expect(usage.get(TUE)).toEqual({ study: 30, work: 0 });
  });

  it('status: ok / near (≥90%) / over with exact over minutes', () => {
    expect(dayLoad(MON, 'work', 300, []).status).toBe('ok');
    expect(dayLoad(MON, 'work', 324, []).status).toBe('near');
    expect(dayLoad(MON, 'study', 150, []).status).toBe('near'); // "Học 2g30 / 2g30"
    const over = dayLoad(MON, 'work', 400, []);
    expect(over).toMatchObject({ status: 'over', overMinutes: 40, maxMinutes: 360 });
  });

  it('anything scheduled on a zero-capacity day is over', () => {
    expect(dayLoad(SAT, 'work', 30, [])).toMatchObject({ status: 'over', overMinutes: 30 });
    expect(dayLoad(SAT, 'work', 0, []).status).toBe('ok');
  });

  it('computeLoads covers requested dates and both spaces', () => {
    const loads = computeLoads(
      [
        { space: 'work', start: at(MON, '08:00'), end: at(MON, '12:00') },
        { space: 'work', start: at(MON, '13:00'), end: at(MON, '15:20') },
      ],
      [],
      [TUE],
    );
    expect(loads.find((l) => l.date === MON && l.space === 'work')).toMatchObject({ usedMinutes: 380, overMinutes: 20 });
    expect(loads.filter((l) => l.date === TUE)).toHaveLength(2);
  });
});
