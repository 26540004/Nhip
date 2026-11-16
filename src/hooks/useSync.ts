/**
 * Google Calendar sync from the app: on open/foreground (throttled), pull-to-refresh,
 * "Đồng bộ ngay" and after block changes. Exposes a status for the Today header dot.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { gcalSync } from '../lib/api/functions';
import { qk, useGoogleConnection } from '../lib/api/queries';
import { ApiError } from '../lib/api/supabase';

type SyncState = 'idle' | 'syncing' | 'error';
const useSyncStore = create<{ state: SyncState; lastAt: number; error: string | null }>(() => ({ state: 'idle', lastAt: 0, error: null }));

const THROTTLE_MS = 60_000;

export function useSync() {
  const qc = useQueryClient();
  const conn = useGoogleConnection().data;
  const connected = Boolean(conn && conn.status !== 'disconnected' && conn.status !== 'revoked');
  const { state, error } = useSyncStore();

  const syncNow = useCallback(
    async (opts: { force?: boolean } = {}) => {
      const s = useSyncStore.getState();
      if (!connected || s.state === 'syncing') return;
      if (!opts.force && Date.now() - s.lastAt < THROTTLE_MS) return;
      useSyncStore.setState({ state: 'syncing', lastAt: Date.now() });
      try {
        await gcalSync();
        useSyncStore.setState({ state: 'idle', error: null });
      } catch (e) {
        useSyncStore.setState({ state: 'error', error: e instanceof ApiError ? e.code : 'gcal_failed' });
      } finally {
        void qc.invalidateQueries({ queryKey: qk.google });
        void qc.invalidateQueries({ queryKey: ['blocks'] });
        void qc.invalidateQueries({ queryKey: ['busy'] });
        void qc.invalidateQueries({ queryKey: ['taskBlocks'] });
      }
    },
    [connected, qc],
  );

  return { connected, conn, state: conn?.status === 'revoked' || conn?.status === 'error' ? 'error' : state, error, syncNow };
}

/** Mount once (root): sync when the app opens or returns to the foreground. */
export function useAutoSync(enabled: boolean) {
  const { syncNow, connected } = useSync();
  useEffect(() => {
    if (!enabled || !connected) return;
    void syncNow();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void syncNow());
    return () => sub.remove();
  }, [enabled, connected, syncNow]);
}
