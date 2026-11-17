/**
 * The recording engine. One instance lives for the whole app (RecorderHost), so a recording
 * keeps going while the user moves between screens or locks the phone (iOS background audio).
 *
 * Every ~10 minutes the current file is closed and a new one started; each closed segment is
 * copied to Documents, recorded as an audio_segments row (offline-capable write queue) and
 * queued for background upload. A crash therefore loses at most the open segment.
 */
import type { QueryClient } from '@tanstack/react-query';
import {
  type AudioRecorder,
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { enqueueWrite, newId } from '../../lib/api/mutations';
import { currentUserId } from '../../lib/api/supabase';
import type { AudioMeta } from '../../lib/api/types';
import { deleteLocal, keepLocal } from '../../lib/media/files';
import { MediaPermissionError } from '../../lib/media/images';
import { useMediaQueue } from '../../lib/media/queue';
import {
  AUDIO_BITRATE,
  AUDIO_SAMPLE_RATE,
  InterruptionDetector,
  levelFromMetering,
  SEGMENT_SEC,
  segmentPath,
} from '../../lib/media/recording';
import { type RecOwner, type RecSegment, useRecorderStore } from './store';

function webMime(): { ext: 'm4a' | 'webm'; mime: string } {
  const MR = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  if (MR?.isTypeSupported?.('audio/mp4')) return { ext: 'm4a', mime: 'audio/mp4' };
  return { ext: 'webm', mime: 'audio/webm' };
}

export function recordingOptions(): RecordingOptions {
  const web = Platform.OS === 'web' ? webMime() : null;
  return {
    extension: '.m4a',
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: 1,
    bitRate: AUDIO_BITRATE,
    isMeteringEnabled: true,
    android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
    ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
    web: { mimeType: web?.mime ?? 'audio/webm', bitsPerSecond: AUDIO_BITRATE },
  };
}

async function notifyInterrupted(): Promise<void> {
  if (Platform.OS === 'web' || AppState.currentState === 'active') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Ghi âm đã tạm dừng',
        body: 'Có cuộc gọi hoặc ứng dụng khác dùng micro. Mở Nhịp để ghi tiếp.',
        data: { url: 'nhip://record' },
      },
      trigger: null,
    });
  } catch {
    /* notifications unavailable */
  }
}

export class RecorderEngine {
  private detector = new InterruptionDetector();
  private rotating = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** True once this JS runtime started the current session (vs. one restored from disk). */
  private liveId: string | null = null;

  constructor(
    private readonly recorder: AudioRecorder,
    private readonly qc: QueryClient,
  ) {}

  private get store() {
    return useRecorderStore.getState();
  }

  attach(): () => void {
    this.timer = setInterval(() => void this.tick(), 250);
    void this.recoverIfNeeded();
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }

  /** A session on disk that this runtime did not start = the app was killed while recording. */
  private async recoverIfNeeded(): Promise<void> {
    const persistApi = useRecorderStore.persist;
    if (!persistApi.hasHydrated()) await new Promise<void>((r) => persistApi.onFinishHydration(() => r()));
    const s = this.store.session;
    if (!s || this.liveId === s.attachmentId) return;
    await this.finish(true);
  }

  async start(opts: { owner: RecOwner; attachmentId?: string; title?: string | null; transcribe: boolean }): Promise<string> {
    if (this.store.session) return this.store.session.attachmentId;
    this.store.set({ busy: true, error: null });
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) throw new MediaPermissionError('microphone');
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
      const uid = await currentUserId();
      const attachmentId = opts.attachmentId ?? newId();
      const { ext, mime } = Platform.OS === 'web' ? webMime() : { ext: 'm4a' as const, mime: 'audio/mp4' };

      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
      this.liveId = attachmentId;
      this.detector.reset();

      const meta: AudioMeta = { recording: 'recording', mime };
      void enqueueWrite(this.qc, 'attachmentCreate', {
        id: attachmentId,
        owner_type: opts.owner.type,
        owner_id: opts.owner.id,
        type: 'audio',
        title: opts.title ?? null,
        storage_path: segmentPath(uid, attachmentId, 0, ext),
        meta_json: meta as Record<string, unknown>,
      }).catch(() => undefined);

      this.store.set({
        session: {
          attachmentId,
          uid,
          owner: opts.owner,
          ext,
          mime,
          startedAt: Date.now(),
          status: 'recording',
          seq: 0,
          closedSec: 0,
          segments: [],
          bookmarks: [],
          transcribe: opts.transcribe,
        },
        segSec: 0,
        level: 0,
        lastResult: null,
      });
      return attachmentId;
    } catch (e) {
      this.store.set({ error: e instanceof MediaPermissionError ? 'mic_denied' : 'start_failed' });
      throw e;
    } finally {
      this.store.set({ busy: false });
    }
  }

  private async tick(): Promise<void> {
    const s = this.store.session;
    if (!s || this.liveId !== s.attachmentId || this.rotating) return;
    let st: ReturnType<AudioRecorder['getStatus']>;
    try {
      st = this.recorder.getStatus();
    } catch {
      return;
    }
    const segSec = (st.durationMillis ?? 0) / 1000;
    this.store.set({
      segSec: s.status === 'recording' || segSec > 0 ? segSec : this.store.segSec,
      level: s.status === 'recording' ? levelFromMetering(st.metering) : 0,
    });

    if (s.status === 'recording') {
      const stalled = this.detector.feed(true, st.isRecording, Date.now()) || st.mediaServicesDidReset;
      if (stalled) {
        this.store.patchSession({ status: 'interrupted' });
        void notifyInterrupted();
        return;
      }
      if (segSec >= SEGMENT_SEC) await this.rotate();
    } else {
      this.detector.feed(false, st.isRecording, Date.now());
    }
  }

  /** Close the current file and continue in a new one. */
  private async rotate(continueRecording = true): Promise<void> {
    if (this.rotating) return;
    this.rotating = true;
    try {
      const dur = this.store.segSec;
      await this.recorder.stop();
      await this.closeSegment(this.recorder.uri, dur);
      if (continueRecording) {
        await this.recorder.prepareToRecordAsync();
        this.recorder.record();
        this.detector.reset();
        this.store.patchSession({ status: 'recording' });
      }
    } catch {
      this.store.patchSession({ status: 'interrupted' });
    } finally {
      this.store.set({ segSec: 0 });
      this.rotating = false;
    }
  }

  private async closeSegment(uri: string | null, durationSec: number): Promise<void> {
    const s = this.store.session;
    if (!s) return;
    if (!uri || durationSec < 0.5) {
      if (uri) deleteLocal(uri);
      return;
    }
    const seq = s.seq;
    const path = segmentPath(s.uid, s.attachmentId, seq, s.ext);
    const local = await keepLocal(uri, `${s.attachmentId}-seg-${String(seq).padStart(3, '0')}.${s.ext}`);
    if (local !== uri) deleteLocal(uri);
    const seg: RecSegment = {
      seq,
      id: newId(),
      path,
      uri: local,
      startOffsetSec: s.closedSec,
      durationSec: Math.round(durationSec * 100) / 100,
    };
    void enqueueWrite(this.qc, 'segmentCreate', {
      id: seg.id,
      attachment_id: s.attachmentId,
      seq,
      storage_path: path,
      mime: s.mime,
      start_offset_sec: seg.startOffsetSec,
      duration_sec: seg.durationSec,
    }).catch(() => undefined);
    useMediaQueue.getState().enqueue({ path, localUri: local, contentType: s.mime, segment: { id: seg.id, attachmentId: s.attachmentId } });
    this.store.patchSession({ segments: [...s.segments, seg], seq: seq + 1, closedSec: s.closedSec + seg.durationSec });
  }

  pause(): void {
    const s = this.store.session;
    if (!s || s.status !== 'recording') return;
    this.recorder.pause();
    this.store.patchSession({ status: 'paused' });
  }

  async resume(): Promise<void> {
    const s = this.store.session;
    if (!s) return;
    if (s.status === 'paused') {
      this.recorder.record();
      this.detector.reset();
      this.store.patchSession({ status: 'recording' });
    } else if (s.status === 'interrupted') {
      // After a call the old file may be unusable for appending: start a fresh segment.
      this.store.set({ busy: true });
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          allowsBackgroundRecording: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        });
        await this.rotate(true);
      } finally {
        this.store.set({ busy: false });
      }
    }
  }

  bookmark(): number {
    const st = this.store;
    if (!st.session) return 0;
    const at = Math.round((st.session.closedSec + st.segSec) * 10) / 10;
    st.patchSession({ bookmarks: [...st.session.bookmarks, { at_sec: at }] });
    return at;
  }

  async stop(): Promise<void> {
    if (!this.store.session) return;
    this.store.set({ busy: true });
    try {
      const dur = this.store.segSec;
      try {
        await this.recorder.stop();
        await this.closeSegment(this.recorder.uri, dur);
      } catch {
        /* recorder already stopped (interruption): keep the closed segments */
      }
      await this.finish(false);
    } finally {
      this.store.set({ busy: false, segSec: 0, level: 0 });
    }
  }

  /** Write the final metadata (or delete an empty recording) and end the session. */
  private async finish(recovered: boolean): Promise<void> {
    const s = this.store.session;
    if (!s) return;
    const total = Math.round(s.segments.reduce((sum, x) => sum + x.durationSec, 0));
    if (s.segments.length === 0) {
      void enqueueWrite(this.qc, 'attachmentDelete', s.attachmentId).catch(() => undefined);
    } else {
      const meta: AudioMeta = { recording: 'done', segment_count: s.segments.length, mime: s.mime };
      const { attachmentId, transcribe } = s;
      if (transcribe) useMediaQueue.getState().addKick(attachmentId, 'start');
      void enqueueWrite(this.qc, 'attachmentUpdate', {
        id: attachmentId,
        patch: { duration_sec: total, bookmarks_json: s.bookmarks, meta_json: meta as Record<string, unknown> },
      })
        // The server needs segment_count to finish the transcript: nudge it once that is saved.
        .then(() => transcribe && useMediaQueue.getState().addKick(attachmentId, 'process'))
        .catch(() => undefined);
    }
    this.liveId = null;
    this.store.set({
      session: null,
      lastResult: {
        attachmentId: s.attachmentId,
        owner: s.owner,
        saved: s.segments.length > 0,
        durationSec: total,
        segmentCount: s.segments.length,
        recovered,
      },
    });
    if (recovered && s.segments.length > 0) showToast(vi.record.recovered(s.segments.length), { durationMs: 6000 });
    try {
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false });
    } catch {
      /* ignore */
    }
  }

  /** Throw the recording away (from the recorder screen, before anything useful was saved). */
  async discard(): Promise<void> {
    const s = this.store.session;
    if (!s) return;
    try {
      await this.recorder.stop();
      if (this.recorder.uri) deleteLocal(this.recorder.uri);
    } catch {
      /* ignore */
    }
    for (const seg of s.segments) deleteLocal(seg.uri);
    useMediaQueue.setState((q) => ({ jobs: q.jobs.filter((j) => j.segment?.attachmentId !== s.attachmentId) }));
    void enqueueWrite(this.qc, 'attachmentDelete', s.attachmentId).catch(() => undefined);
    this.liveId = null;
    this.store.set({
      session: null,
      segSec: 0,
      level: 0,
      lastResult: { attachmentId: s.attachmentId, owner: s.owner, saved: false, durationSec: 0, segmentCount: 0 },
    });
  }
}

let engine: RecorderEngine | null = null;
export const setEngine = (e: RecorderEngine | null) => {
  engine = e;
};
export function getEngine(): RecorderEngine {
  if (!engine) throw new Error('recorder not ready');
  return engine;
}
