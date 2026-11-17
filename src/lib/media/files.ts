/**
 * Local media files and uploads to the private `attachments` bucket.
 *
 * iOS: files live in Documents/media (survive restarts); uploads use a signed upload URL and
 * the native background URL session, so a segment keeps uploading while the phone is locked.
 * Web: picked/recorded files are blob/data URLs and are uploaded with supabase-js.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { isDemo, requireSupabase } from '../api/supabase';

const BUCKET = 'attachments';
const native = Platform.OS !== 'web' && !isDemo;

function mediaDir(): Directory {
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Copy a temporary file (picker, manipulator, recorder cache) somewhere permanent. */
export async function keepLocal(uri: string, name: string): Promise<string> {
  if (!native) return uri;
  const src = new File(uri);
  const dest = new File(mediaDir(), name);
  if (dest.exists) dest.delete();
  await src.copy(dest);
  return dest.uri;
}

export function localExists(uri: string): boolean {
  if (!native) return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function deleteLocal(uri: string): void {
  if (!native) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export async function uploadLocal(path: string, uri: string, contentType: string): Promise<void> {
  const db = requireSupabase();
  if (native) {
    const file = new File(uri);
    if (!file.exists) throw new UploadError('local file missing', true);
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new UploadError(error?.message ?? 'no upload url', false);
    const res = await file.upload(data.signedUrl, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      mimeType: contentType,
      sessionType: 'background',
    });
    if (res.status >= 400) throw new UploadError(`upload HTTP ${res.status}`, res.status === 400 || res.status === 413);
    return;
  }
  const blob = await (await fetch(uri)).blob();
  const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true });
  if (error) throw new UploadError(error.message, false);
}
