/**
 * Background worker for the media queue: uploads files one at a time, marks audio segments
 * uploaded (through the ordered write queue) and sends transcription requests once online.
 * Mounted once in the root layout. While a recording runs, iOS keeps the app alive (audio
 * background mode), so segments upload with the screen locked.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useOnline } from '../../hooks/useOnline';
import { transcribe } from '../api/functions';
import { enqueueWrite } from '../api/mutations';
import { qk } from '../api/queries';
import { ApiError } from '../api/supabase';
import { UploadError, uploadLocal } from './files';
import { nextDueJob, nextWakeAt, useMediaQueue } from './queue';

const KICK_RETRY_MS = 30_000;
const MAX_KICK_ATTEMPTS = 6;

export function useUploadWorker(enabled: boolean): void {
  const qc = useQueryClient();
  const online = useOnline();
  const jobs = useMediaQueue((s) => s.jobs);
  const kicks = useMediaQueue((s) => s.kicks);
  const [tick, setTick] = useState(0);
  const uploading = useRef(false);
  const kicking = useRef(new Set<string>());
  const kickAttempts = useRef(new Map<string, number>());

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setTick((t) => t + 1));
    return () => sub.remove();
  }, []);

  // Uploads
  useEffect(() => {
    if (!enabled || !online || uploading.current) return;
    const now = Date.now();
    const job = nextDueJob(jobs, now);
    if (!job) {
      const wake = nextWakeAt(jobs);
      if (wake == null) return;
      const t = setTimeout(() => setTick((x) => x + 1), Math.max(1000, wake - now));
      return () => clearTimeout(t);
    }
    uploading.current = true;
    void (async () => {
      try {
        await uploadLocal(job.path, job.localUri, job.contentType);
        useMediaQueue.getState().complete(job.path);
        if (job.segment) {
          const { id, attachmentId } = job.segment;
          await enqueueWrite(qc, 'segmentUpdate', { id, patch: { uploaded: true } }).catch(() => undefined);
          void qc.invalidateQueries({ queryKey: qk.segments(attachmentId) });
          useMediaQueue.getState().addKick(attachmentId, 'process');
        }
      } catch (e) {
        const permanent = e instanceof UploadError && e.permanent;
        useMediaQueue.getState().failed(job.path, e instanceof Error ? e.message : 'upload failed', permanent);
      } finally {
        uploading.current = false;
        setTick((x) => x + 1);
      }
    })();
  }, [enabled, online, jobs, tick, qc]);

  // Transcription requests
  useEffect(() => {
    if (!enabled || !online) return;
    const entries = Object.entries(kicks).filter(([id]) => !kicking.current.has(id));
    if (entries.length === 0) return;
    let retryLater = false;
    for (const [attachmentId, kick] of entries) {
      kicking.current.add(attachmentId);
      transcribe(attachmentId, kick)
        .then(() => {
          kickAttempts.current.delete(attachmentId);
          useMediaQueue.getState().clearKick(attachmentId);
        })
        .catch((e: unknown) => {
          const n = (kickAttempts.current.get(attachmentId) ?? 0) + 1;
          kickAttempts.current.set(attachmentId, n);
          const final = e instanceof ApiError && ['privacy_mode', 'ai_unavailable', 'bad_request', 'demo_unavailable'].includes(e.code);
          // not_found: the recording row may still be in the offline write queue.
          if (final || n >= MAX_KICK_ATTEMPTS) useMediaQueue.getState().clearKick(attachmentId);
          else retryLater = true;
        })
        .finally(() => {
          kicking.current.delete(attachmentId);
          void qc.invalidateQueries({ queryKey: ['attachments'] });
          void qc.invalidateQueries({ queryKey: qk.segments(attachmentId) });
          if (retryLater) setTimeout(() => setTick((x) => x + 1), KICK_RETRY_MS);
        });
    }
  }, [enabled, online, kicks, tick, qc]);
}
