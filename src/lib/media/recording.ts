/**
 * Recording helpers (pure, unit-tested): segment naming, level meter, interruption detection,
 * and mapping a position in the whole recording to (segment, offset) for playback.
 */

/** Each segment is closed and uploaded after this long (~10 minutes). */
export const SEGMENT_SEC = 600;

/** AAC in MP4, mono, speech quality: ~40 kbps ≈ 3 MB per 10-minute segment. */
export const AUDIO_BITRATE = 40_000;
export const AUDIO_SAMPLE_RATE = 22_050;

export function segmentPath(uid: string, attachmentId: string, seq: number, ext: 'm4a' | 'webm'): string {
  return `${uid}/${attachmentId}/seg-${String(seq).padStart(3, '0')}.${ext}`;
}

/** Recorder metering (dBFS, about −160…0) → 0…1 for the level bar. */
export function levelFromMetering(db: number | null | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 55) / 50));
}

/**
 * iOS pauses the recorder on calls, Siri, alarms or another app taking the mic. We notice
 * when the recorder stops advancing while we expect it to record.
 */
export class InterruptionDetector {
  private since: number | null = null;
  constructor(private readonly thresholdMs = 1500) {}

  /** Returns true once the recorder has been stalled for longer than the threshold. */
  feed(expectRecording: boolean, isRecording: boolean, now: number): boolean {
    if (!expectRecording || isRecording) {
      this.since = null;
      return false;
    }
    if (this.since == null) this.since = now;
    return now - this.since >= this.thresholdMs;
  }

  reset(): void {
    this.since = null;
  }
}

export interface TimelineSegment {
  seq: number;
  start_offset_sec: number;
  duration_sec: number;
}

/** Position (seconds in the whole recording) → which segment to play and where. */
export function locate(segments: readonly TimelineSegment[], totalSec: number): { index: number; offset: number } | null {
  if (segments.length === 0) return null;
  const sorted = [...segments].sort((a, b) => a.seq - b.seq);
  const t = Math.max(0, totalSec);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const end = Number(s.start_offset_sec) + Number(s.duration_sec);
    if (t < end || i === sorted.length - 1) {
      return { index: i, offset: Math.max(0, Math.min(t - Number(s.start_offset_sec), Number(s.duration_sec))) };
    }
  }
  return null;
}

export function totalDuration(segments: readonly TimelineSegment[]): number {
  return segments.reduce((sum, s) => Math.max(sum, Number(s.start_offset_sec) + Number(s.duration_sec)), 0);
}

/** "Ghi âm 09:53 · 17/11" in the user's time zone. */
export function recordingTitle(at: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour12: false,
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `Ghi âm ${parts.hour}:${parts.minute} · ${parts.day}/${parts.month}`;
}

/** "1:02:03" / "12:34" for the recorder timer and player. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}
