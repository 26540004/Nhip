/**
 * Upload queue (pure state + scheduling; the worker lives in useUploadWorker).
 *
 * Every file to upload (image, thumbnail, audio segment) is a job keyed by its storage path.
 * Jobs persist across restarts, retry with exponential backoff and run one at a time.
 * `local` remembers where each file lives on the device, so notes show images and play
 * recordings immediately, before (and without) the network.
 * `kicks` are transcription requests waiting for the network.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface UploadJob {
  /** Storage path, e.g. "<uid>/<attachmentId>/seg-003.m4a". */
  path: string;
  localUri: string;
  contentType: string;
  /** Mark this audio segment uploaded once the file is stored. */
  segment?: { id: string; attachmentId: string };
  attempts: number;
  nextAt: number;
  lastError?: string | null;
}

export type Kick = 'start' | 'process';

export const MAX_UPLOAD_ATTEMPTS = 12;

/** 5 s, 10 s, 20 s … capped at 10 minutes. */
export function uploadBackoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

export function nextDueJob(jobs: readonly UploadJob[], now: number): UploadJob | null {
  let best: UploadJob | null = null;
  for (const j of jobs) {
    if (j.attempts >= MAX_UPLOAD_ATTEMPTS) continue;
    if (j.nextAt > now) continue;
    if (!best || j.nextAt < best.nextAt) best = j;
  }
  return best;
}

/** Earliest time any waiting job becomes due (to schedule the next wake-up). */
export function nextWakeAt(jobs: readonly UploadJob[]): number | null {
  const times = jobs.filter((j) => j.attempts < MAX_UPLOAD_ATTEMPTS).map((j) => j.nextAt);
  return times.length ? Math.min(...times) : null;
}

/** 'start' wins over 'process' for the same recording. */
export function mergeKick(current: Kick | undefined, next: Kick): Kick {
  return current === 'start' || next === 'start' ? 'start' : 'process';
}

interface MediaQueueState {
  jobs: UploadJob[];
  local: Record<string, string>;
  kicks: Record<string, Kick>;
  enqueue: (job: Omit<UploadJob, 'attempts' | 'nextAt'>) => void;
  complete: (path: string) => void;
  failed: (path: string, error: string, permanent: boolean) => void;
  retryAll: () => void;
  setLocal: (path: string, uri: string) => void;
  addKick: (attachmentId: string, kick: Kick) => void;
  clearKick: (attachmentId: string) => void;
}

export const useMediaQueue = create<MediaQueueState>()(
  persist(
    (set) => ({
      jobs: [],
      local: {},
      kicks: {},
      enqueue: (job) =>
        set((s) => ({
          jobs: [...s.jobs.filter((j) => j.path !== job.path), { ...job, attempts: 0, nextAt: Date.now() }],
          local: { ...s.local, [job.path]: job.localUri },
        })),
      complete: (path) => set((s) => ({ jobs: s.jobs.filter((j) => j.path !== path) })),
      failed: (path, error, permanent) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.path === path
              ? {
                  ...j,
                  attempts: permanent ? MAX_UPLOAD_ATTEMPTS : j.attempts + 1,
                  nextAt: Date.now() + uploadBackoffMs(j.attempts + 1),
                  lastError: error,
                }
              : j,
          ),
        })),
      retryAll: () => set((s) => ({ jobs: s.jobs.map((j) => ({ ...j, attempts: Math.min(j.attempts, 1), nextAt: Date.now() })) })),
      setLocal: (path, uri) => set((s) => ({ local: { ...s.local, [path]: uri } })),
      addKick: (id, kick) => set((s) => ({ kicks: { ...s.kicks, [id]: mergeKick(s.kicks[id], kick) } })),
      clearKick: (id) =>
        set((s) => {
          const kicks = { ...s.kicks };
          delete kicks[id];
          return { kicks };
        }),
    }),
    {
      name: 'nhip-media-queue-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Blob/data URLs (web) die with the page or are too big to store; keep only file:// paths.
      partialize: (s) => ({
        jobs: s.jobs.filter((j) => j.localUri.startsWith('file:')),
        local: Object.fromEntries(Object.entries(s.local).filter(([, uri]) => uri.startsWith('file:'))),
        kicks: s.kicks,
      }),
    },
  ),
);

export function pendingUploads(jobs: readonly UploadJob[], prefix?: string): number {
  return jobs.filter((j) => j.attempts < MAX_UPLOAD_ATTEMPTS && (!prefix || j.path.includes(prefix))).length;
}
