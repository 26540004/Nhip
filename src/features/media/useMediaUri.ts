import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { qk, useSignedUrl } from '../../lib/api/queries';
import { requireSupabase } from '../../lib/api/supabase';
import { localExists } from '../../lib/media/files';
import { useMediaQueue } from '../../lib/media/queue';

/** The on-device copy when there is one, otherwise a signed URL of the stored object. */
export function useMediaUri(path: string | null | undefined): string | null {
  const local = useMediaQueue((s) => (path ? s.local[path] : undefined));
  const usable = local && localExists(local) ? local : null;
  const signed = useSignedUrl(usable ? null : path);
  return usable ?? signed.data ?? null;
}

/** Imperative variant for the audio player (segments are resolved on demand). */
export function useResolveMedia() {
  const qc = useQueryClient();
  return useCallback(
    async (path: string): Promise<string | null> => {
      const local = useMediaQueue.getState().local[path];
      if (local && localExists(local)) return local;
      try {
        return await qc.fetchQuery({
          queryKey: qk.signedUrl(path),
          staleTime: 50 * 60_000,
          retry: false,
          meta: { persist: false },
          queryFn: async () => {
            const { data, error } = await requireSupabase().storage.from('attachments').createSignedUrl(path, 3600);
            if (error || !data) throw error ?? new Error('no url');
            return data.signedUrl;
          },
        });
      } catch {
        return null;
      }
    },
    [qc],
  );
}
