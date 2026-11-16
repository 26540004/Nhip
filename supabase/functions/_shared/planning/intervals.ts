import { MINUTE, type Instant } from './tz.ts';

/** Half-open interval [start, end) in epoch ms. */
export interface Interval {
  start: Instant;
  end: Instant;
}

export function durationMinutes(i: Interval): number {
  return Math.round((i.end - i.start) / MINUTE);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** Sort and merge overlapping or touching intervals. Drops empty ones. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** base − cuts. Result is merged and sorted. */
export function subtractIntervals(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const mergedCuts = mergeIntervals(cuts);
  const result: Interval[] = [];
  for (const b of mergeIntervals(base)) {
    let pieces: Interval[] = [b];
    for (const c of mergedCuts) {
      if (c.start >= b.end) break;
      if (c.end <= b.start) continue;
      const next: Interval[] = [];
      for (const p of pieces) {
        if (!overlaps(p, c)) {
          next.push(p);
          continue;
        }
        if (p.start < c.start) next.push({ start: p.start, end: c.start });
        if (c.end < p.end) next.push({ start: c.end, end: p.end });
      }
      pieces = next;
    }
    result.push(...pieces);
  }
  return result;
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const x = A[i]!;
    const y = B[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (start < end) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

export function totalMinutes(list: readonly Interval[]): number {
  return mergeIntervals(list).reduce((sum, i) => sum + durationMinutes(i), 0);
}

/** Expand each interval by `minutes` on both sides (used for buffers). */
export function pad(list: readonly Interval[], minutes: number): Interval[] {
  return list.map((i) => ({ start: i.start - minutes * MINUTE, end: i.end + minutes * MINUTE }));
}

export function clip(list: readonly Interval[], window: Interval): Interval[] {
  return intersectIntervals(list, [window]);
}
