/**
 * Recorder session state. The session is persisted, so if iOS kills the app mid-lecture the
 * segments already closed (and queued for upload) are recovered on the next launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Bookmark } from '../../lib/api/types';

export interface RecSegment {
  seq: number;
  id: string;
  path: string;
  uri: string;
  startOffsetSec: number;
  durationSec: number;
}

export interface RecOwner {
  type: 'note' | 'task';
  id: string;
}

export interface RecSession {
  attachmentId: string;
  uid: string;
  owner: RecOwner;
  ext: 'm4a' | 'webm';
  mime: string;
  startedAt: number;
  status: 'recording' | 'paused' | 'interrupted';
  /** Seq of the segment being recorded now. */
  seq: number;
  /** Seconds in closed segments (= start offset of the current one). */
  closedSec: number;
  segments: RecSegment[];
  bookmarks: Bookmark[];
  transcribe: boolean;
}

export interface RecResult {
  attachmentId: string;
  owner: RecOwner;
  saved: boolean;
  durationSec: number;
  segmentCount: number;
  recovered?: boolean;
  /** Set once the recorder screen has shown this result. */
  seen?: boolean;
}

interface RecorderState {
  session: RecSession | null;
  /** Live values (not persisted): seconds in the current segment, mic level 0..1. */
  segSec: number;
  level: number;
  busy: boolean;
  error: string | null;
  lastResult: RecResult | null;
  /** Audio blocks inserted by the editor for a recording that never started. */
  abandoned: string[];
  set: (patch: Partial<Omit<RecorderState, 'set' | 'patchSession'>>) => void;
  patchSession: (patch: Partial<RecSession>) => void;
}

export const useRecorderStore = create<RecorderState>()(
  persist(
    (set) => ({
      session: null,
      segSec: 0,
      level: 0,
      busy: false,
      error: null,
      lastResult: null,
      abandoned: [],
      set: (patch) => set(patch),
      patchSession: (patch) => set((s) => (s.session ? { session: { ...s.session, ...patch } } : {})),
    }),
    {
      name: 'nhip-recorder-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ session: s.session, lastResult: s.lastResult, abandoned: s.abandoned }),
    },
  ),
);

export function elapsedSec(s: Pick<RecorderState, 'session' | 'segSec'>): number {
  return s.session ? s.session.closedSec + s.segSec : 0;
}
