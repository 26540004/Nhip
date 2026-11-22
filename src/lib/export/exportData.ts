/**
 * "Xuất dữ liệu": read everything the user owns (RLS), build the files (build.ts), zip them
 * and hand the .zip to the share sheet (iPhone) or download it (web).
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';
import { Platform } from 'react-native';
import { isDemo, requireSupabase, unwrap } from '../api/supabase';
import { buildExport } from './build';

/** Columns per table. Google tokens, push tokens and the Google event cache are left out. */
const TABLES: Record<string, string> = {
  profiles: 'id, display_name, timezone, ai_privacy_mode, onboarding_completed_at, created_at',
  collections: '*',
  tasks: '*',
  task_blocks: 'id, task_id, start_at, end_at, status, proposal_id, reason, gcal_event_id, gcal_calendar_id, last_synced_at, created_at',
  notes: 'id, space, collection_id, title, content_json, plain_text, pinned, created_at, updated_at',
  attachments:
    'id, owner_type, owner_id, type, storage_path, url, title, meta_json, duration_sec, bookmarks_json, transcript_status, transcript_text, summary_json, created_at',
  audio_segments:
    'id, attachment_id, seq, storage_path, mime, start_offset_sec, duration_sec, uploaded, transcript_status, transcript_json',
  work_hours: '*',
  study_windows: '*',
  class_sessions: '*',
  schedule_exceptions: '*',
  capacity_settings: '*',
  habit_settings: 'learning_enabled, answers, updated_at',
  vocab_entries: 'id, short, meaning, collection_id, source, created_at',
  ai_corrections: 'id, input_text, field, ai_value, user_value, created_at',
  reminder_settings: '*',
  google_connections: 'google_email, target_calendar_id, read_calendar_ids, status, last_synced_at',
};

const LINK_TTL_SEC = 7 * 86_400;

async function signedLinks(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const storage = requireSupabase().storage.from('attachments');
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    try {
      if ('createSignedUrls' in storage) {
        const { data } = await storage.createSignedUrls(chunk, LINK_TTL_SEC);
        for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      } else {
        for (const p of chunk) {
          const { data } = await (
            storage as { createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl: string } | null }> }
          ).createSignedUrl(p, LINK_TTL_SEC);
          if (data?.signedUrl && !data.signedUrl.startsWith('blob:') && !data.signedUrl.startsWith('data:')) out[p] = data.signedUrl;
        }
      }
    } catch {
      /* links are a convenience; paths are still listed */
    }
  }
  return out;
}

export async function collectExport(now = Date.now()): Promise<Record<string, string>> {
  const db = requireSupabase();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, cols] of Object.entries(TABLES)) {
    try {
      tables[name] = unwrap(await db.from(name).select(cols)) as Record<string, unknown>[];
    } catch (e) {
      // A table the demo doesn't have is fine; a real network/RLS error is not.
      if (!isDemo) throw e;
      tables[name] = [];
    }
  }
  const tz = String(tables.profiles?.[0]?.timezone ?? 'Asia/Ho_Chi_Minh');
  const paths = [
    ...(tables.attachments ?? []).flatMap((a) => (a.type === 'image' && typeof a.storage_path === 'string' ? [a.storage_path] : [])),
    ...(tables.audio_segments ?? []).flatMap((s) => (s.uploaded && typeof s.storage_path === 'string' ? [s.storage_path] : [])),
  ];
  const links = await signedLinks(paths);
  return buildExport({ exportedAt: now, tz, tables, links });
}

export function zipFiles(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}

export function exportFileName(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `nhip-du-lieu-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** Build, zip and share/download. Returns the number of files in the archive. */
export async function exportAll(): Promise<number> {
  const files = await collectExport();
  const bytes = zipFiles(files);
  const name = exportFileName();
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } else {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(bytes);
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: name });
  }
  return Object.keys(files).length;
}
