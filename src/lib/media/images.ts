/**
 * Images for notes and tasks: pick (camera / library) → compress to ≤ 1920 px, JPEG ~80 % →
 * 480 px thumbnail → keep both on the device → attachment row (offline-capable) → upload
 * queue. The note shows the local file at once; other devices use signed URLs.
 */
import type { QueryClient } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { enqueueWrite, newId } from '../api/mutations';
import { currentUserId } from '../api/supabase';
import type { ImageMeta } from '../api/types';
import { keepLocal } from './files';
import { useMediaQueue } from './queue';
import { fitWithin } from './util';

export { fitWithin };

export const FULL_MAX_PX = 1920;
export const THUMB_PX = 480;

export class MediaPermissionError extends Error {
  constructor(readonly kind: 'camera' | 'library' | 'microphone') {
    super(`${kind} permission denied`);
    this.name = 'MediaPermissionError';
  }
}

export async function pickImages(source: 'camera' | 'library'): Promise<ImagePicker.ImagePickerAsset[]> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new MediaPermissionError('camera');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    return res.canceled ? [] : res.assets;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 6,
    quality: 1,
    exif: false,
  });
  return res.canceled ? [] : res.assets;
}

async function render(uri: string, width: number, height: number, max: number, compress: number) {
  const ctx = ImageManipulator.manipulate(uri);
  const size = fitWithin(width, height, max);
  if (size) ctx.resize(size);
  const ref = await ctx.renderAsync();
  return ref.saveAsync({ compress, format: SaveFormat.JPEG });
}

/** Compress, store locally, create the attachment and queue both uploads. Returns its id. */
export async function addImage(
  qc: QueryClient,
  owner: { type: 'note' | 'task'; id: string },
  asset: Pick<ImagePicker.ImagePickerAsset, 'uri' | 'width' | 'height'>,
): Promise<string> {
  const uid = await currentUserId();
  const id = newId();
  const full = await render(asset.uri, asset.width, asset.height, FULL_MAX_PX, 0.8);
  const thumb = await render(full.uri, full.width, full.height, THUMB_PX, 0.7);
  const path = `${uid}/${id}.jpg`;
  const thumbPath = `${uid}/${id}_thumb.jpg`;
  const [fullLocal, thumbLocal] = await Promise.all([keepLocal(full.uri, `${id}.jpg`), keepLocal(thumb.uri, `${id}_thumb.jpg`)]);

  const meta: ImageMeta = { width: full.width, height: full.height, thumb_path: thumbPath };
  const q = useMediaQueue.getState();
  q.setLocal(path, fullLocal);
  q.setLocal(thumbPath, thumbLocal);
  // Row first (ordered write queue), files after: the thumbnail is what lists show.
  void enqueueWrite(qc, 'attachmentCreate', {
    id,
    owner_type: owner.type,
    owner_id: owner.id,
    type: 'image',
    storage_path: path,
    meta_json: meta as unknown as Record<string, unknown>,
  }).catch(() => undefined);
  q.enqueue({ path: thumbPath, localUri: thumbLocal, contentType: 'image/jpeg' });
  q.enqueue({ path, localUri: fullLocal, contentType: 'image/jpeg' });
  return id;
}
