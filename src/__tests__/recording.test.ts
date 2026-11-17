import {
  formatDuration,
  InterruptionDetector,
  levelFromMetering,
  locate,
  recordingTitle,
  segmentPath,
  totalDuration,
} from '../lib/media/recording';

describe('recording helpers', () => {
  it('names segment files under the owner folder', () => {
    expect(segmentPath('u1', 'a1', 7, 'm4a')).toBe('u1/a1/seg-007.m4a');
  });

  it('maps metering to a 0..1 level', () => {
    expect(levelFromMetering(-160)).toBe(0);
    expect(levelFromMetering(0)).toBe(1);
    expect(levelFromMetering(-30)).toBeCloseTo(0.5);
    expect(levelFromMetering(undefined)).toBe(0);
  });

  it('flags an interruption only after the recorder stalls past the threshold', () => {
    const d = new InterruptionDetector(1500);
    expect(d.feed(true, true, 0)).toBe(false);
    expect(d.feed(true, false, 1000)).toBe(false);
    expect(d.feed(true, false, 2000)).toBe(false);
    expect(d.feed(true, false, 2600)).toBe(true);
    expect(d.feed(false, false, 3000)).toBe(false); // paused by the user: not an interruption
    expect(d.feed(true, false, 3100)).toBe(false); // timer restarted
  });

  it('locates a position across segments (with a small gap between them)', () => {
    const segs = [
      { seq: 1, start_offset_sec: 600.4, duration_sec: 300 },
      { seq: 0, start_offset_sec: 0, duration_sec: 600 },
    ];
    expect(locate(segs, 0)).toEqual({ index: 0, offset: 0 });
    expect(locate(segs, 599)).toEqual({ index: 0, offset: 599 });
    expect(locate(segs, 600.2)).toEqual({ index: 1, offset: 0 });
    expect(locate(segs, 700.4)).toEqual({ index: 1, offset: 100 });
    expect(locate(segs, 5000)).toEqual({ index: 1, offset: 300 });
    expect(locate([], 5)).toBeNull();
    expect(totalDuration(segs)).toBeCloseTo(900.4);
  });

  it('formats titles and durations', () => {
    expect(recordingTitle(Date.parse('2026-11-17T02:53:00Z'), 'Asia/Ho_Chi_Minh')).toBe('Ghi âm 09:53 · 17/11');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(59.9)).toBe('00:59');
  });
});
