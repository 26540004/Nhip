import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { queryClient } from '../../lib/api/queryClient';
import { supabase } from '../../lib/api/supabase';

interface SessionState {
  session: Session | null;
  /** False until the stored session has been restored. */
  ready: boolean;
}

export const useSessionStore = create<SessionState>(() => ({ session: null, ready: !supabase }));

let started = false;

/** Restore the stored session and follow auth changes. Idempotent. */
export function startSessionListener(): void {
  if (started || !supabase) return;
  started = true;
  void supabase.auth.getSession().then(({ data }) => useSessionStore.setState({ session: data.session, ready: true }));
  supabase.auth.onAuthStateChange((event, session) => {
    const prev = useSessionStore.getState().session;
    useSessionStore.setState({ session, ready: true });
    // Another user (or sign-out) → drop cached data so nothing leaks between accounts.
    if (event === 'SIGNED_OUT' || (prev && session && prev.user.id !== session.user.id)) queryClient.clear();
  });
}

export function useSession(): SessionState {
  return useSessionStore();
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
  queryClient.clear();
}
