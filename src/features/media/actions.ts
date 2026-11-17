/** Adding media to a note or task (shared by the note editor and task detail). */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { enqueueWrite, newId } from '../../lib/api/mutations';
import { addImage, MediaPermissionError, pickImages } from '../../lib/media/images';

export { normalizeUrl } from '../../lib/media/util';

export type Owner = { type: 'note' | 'task'; id: string };

export function useMediaActions(owner: Owner) {
  const qc = useQueryClient();

  /** Pick and add images; returns the new attachment ids in order. */
  const addImages = useCallback(
    async (source: 'camera' | 'library'): Promise<string[]> => {
      try {
        const assets = await pickImages(Platform.OS === 'web' ? 'library' : source);
        const ids: string[] = [];
        for (const a of assets) ids.push(await addImage(qc, owner, a));
        return ids;
      } catch (e) {
        if (e instanceof MediaPermissionError) showToast(vi.errors.camera_denied ?? '', { tone: 'error', durationMs: 5000 });
        else showToast(vi.errors.internal ?? '', { tone: 'error' });
        return [];
      }
    },
    [qc, owner],
  );

  const addLink = useCallback(
    (url: string, title?: string | null): string => {
      const id = newId();
      void enqueueWrite(qc, 'attachmentCreate', {
        id,
        owner_type: owner.type,
        owner_id: owner.id,
        type: 'link',
        url,
        title: title ?? null,
        meta_json: {},
      }).catch(() => undefined);
      return id;
    },
    [qc, owner],
  );

  return { addImages, addLink };
}
