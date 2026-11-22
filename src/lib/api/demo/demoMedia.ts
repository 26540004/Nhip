/**
 * Demo stand-ins for Storage and the Phase 5 functions. Nothing leaves the browser:
 *  - storage: files kept as object URLs (thumbnails also as data URLs in localStorage)
 *  - link-preview: a card from the address itself (no fetching)
 *  - transcribe-audio: walks through the segments like the server would, with sample text
 *  - note-ai: summary / task suggestions from the note's own structure (no AI)
 */
import { normalizeSplit } from '../../../../supabase/functions/_shared/split-task-core.ts';
import { vi } from '../../../i18n/vi';
import { docToPlainText, normalizeDoc } from '../../notes/doc';
import type { ParseTaskResponse, TranscriptSummary } from '../types';
import { DEMO_UID, type DemoDb, type Row } from './demoDb';
import { demoParse } from './demoParse';
import { DEMO_WHITEBOARD } from './seedMedia';
import { expiryFrom } from '../../../../supabase/functions/_shared/audio-retention.ts';

const THUMBS_KEY = 'nhip-demo-thumbs-v1';
const objects = new Map<string, string>();

function loadThumbs(): Record<string, string> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(THUMBS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const demoStorage = {
  from: () => ({
    upload: async (path: string, body: Blob) => {
      objects.set(path, URL.createObjectURL(body));
      if (path.endsWith('_thumb.jpg') && body.size < 150_000) {
        try {
          const thumbs = loadThumbs();
          thumbs[path] = await blobToDataUrl(body);
          globalThis.localStorage?.setItem(THUMBS_KEY, JSON.stringify(thumbs));
        } catch {
          /* storage full or unavailable */
        }
      }
      return { data: { path }, error: null };
    },
    createSignedUploadUrl: async () => ({ data: null, error: { message: 'demo: use upload()' } }),
    createSignedUrl: async (path: string) => {
      const url = objects.get(path) ?? loadThumbs()[path] ?? (path.endsWith('demo-whiteboard.svg') ? DEMO_WHITEBOARD : null);
      return url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: 'Object not found' } };
    },
    remove: async (paths: string[]) => {
      const thumbs = loadThumbs();
      for (const p of paths) {
        const u = objects.get(p);
        if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
        objects.delete(p);
        delete thumbs[p];
      }
      try {
        globalThis.localStorage?.setItem(THUMBS_KEY, JSON.stringify(thumbs));
      } catch {
        /* ignore */
      }
      return { data: [], error: null };
    },
  }),
};

export function demoLinkPreview(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
  const title = last ? last.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '') : host;
  return {
    url: u.href,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    description: vi.demo.linkPreview,
    image: null,
    site_name: host,
  };
}

// ---------------------------------------------------------------------------
// transcribe-audio
// ---------------------------------------------------------------------------

const running = new Set<string>();

function sampleLines(seq: number, start: number, duration: number) {
  const out = [];
  for (let t = 5; t < duration; t += 150) out.push({ t: start + t, text: vi.demo.transcriptLine(seq + 1, Math.round((start + t) / 60)) });
  return out;
}

function snapshot(db: DemoDb, id: string) {
  const att = db.table('attachments').find((a) => a.id === id);
  const segs = db.table('audio_segments').filter((s) => s.attachment_id === id);
  const meta = (att?.meta_json ?? {}) as { segment_count?: number };
  return {
    transcript_status: String(att?.transcript_status ?? 'none'),
    total: Math.max(meta.segment_count ?? 0, segs.length),
    done: segs.filter((s) => s.transcript_status === 'done').length,
    failed: segs.filter((s) => s.transcript_status === 'failed').length,
  };
}

function step(db: DemoDb, id: string): void {
  const att = db.table('attachments').find((a) => a.id === id);
  if (!att || att.transcript_status !== 'processing') {
    running.delete(id);
    return;
  }
  const segs = db
    .table('audio_segments')
    .filter((s) => s.attachment_id === id)
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  const next = segs.find((s) => s.uploaded && (s.transcript_status === 'pending' || s.transcript_status === 'none'));
  if (next) {
    next.transcript_status = 'done';
    next.transcript_json = sampleLines(Number(next.seq), Number(next.start_offset_sec), Number(next.duration_sec));
    next.updated_at = new Date().toISOString();
    db.save();
    setTimeout(() => step(db, id), 1800);
    return;
  }
  const meta = (att.meta_json ?? {}) as { recording?: string; segment_count?: number };
  if (meta.recording === 'done' && segs.length >= (meta.segment_count ?? 0) && segs.every((s) => s.transcript_status === 'done')) {
    const lines = segs.flatMap((s) => (s.transcript_json as { t: number; text: string }[]) ?? []);
    att.transcript_text = lines.map((l) => l.text).join('\n');
    att.transcript_status = 'done';
    att.audio_expires_at = att.audio_expires_at ?? expiryFrom(Date.now());
    att.summary_json = {
      main_points: [vi.demo.summaryPoint(segs.length)],
      key_terms: [],
      homework: [{ title: vi.demo.summaryHomework, deadline_hint: 'thứ 6' }],
    } satisfies TranscriptSummary;
    att.updated_at = new Date().toISOString();
    db.save();
  }
  running.delete(id);
}

export function demoTranscribe(db: DemoDb, body: Record<string, unknown>) {
  const id = String(body.attachment_id ?? '');
  const action = String(body.action ?? 'process');
  const att = db.table('attachments').find((a) => a.id === id);
  if (!att) return { status: 404, error: 'not_found' as const };
  if (action === 'delete_audio') {
    if (att.transcript_status !== 'done') return { status: 409, error: 'not_ready' as const };
    att.audio_deleted_at = att.audio_deleted_at ?? new Date().toISOString();
    att.audio_expires_at = null;
    db.save();
    return { status: 200, data: { audio_deleted_at: att.audio_deleted_at } };
  }
  const privacy = Boolean(db.table('profiles')[0]?.ai_privacy_mode);
  if (privacy) return { status: 403, error: 'privacy_mode' as const };
  if (action === 'start' || action === 'retry') {
    att.transcript_status = 'processing';
    for (const s of db.table('audio_segments'))
      if (s.attachment_id === id && s.transcript_status !== 'done') s.transcript_status = 'pending';
    db.save();
  }
  if (action === 'summarize' && att.transcript_status === 'done') {
    att.summary_json = att.summary_json ?? { main_points: [vi.demo.summaryPoint(1)], key_terms: [], homework: [] };
    db.save();
  }
  if (att.transcript_status === 'processing' && !running.has(id)) {
    running.add(id);
    setTimeout(() => step(db, id), 1200);
  }
  return { status: 202, data: snapshot(db, id) };
}

// ---------------------------------------------------------------------------
// note-ai
// ---------------------------------------------------------------------------

export function demoNoteAi(db: DemoDb, body: Record<string, unknown>, now: number) {
  const note = db.table('notes').find((n) => n.id === body.note_id);
  if (!note) return { status: 404, error: 'not_found' as const };
  if (db.table('profiles')[0]?.ai_privacy_mode) return { status: 403, error: 'privacy_mode' as const };
  const doc = normalizeDoc(note.content_json, String(note.plain_text ?? ''));
  const texts = doc.blocks.filter((b): b is Extract<typeof b, { text: string }> => 'text' in b);
  const clean = (t: string) => t.replace(/\*\*|_/g, '').trim();
  const open = texts.filter((b) => b.type === 'check' && !b.checked && !b.taskId && b.text.trim());

  if (body.action === 'summarize') {
    const points = texts.filter((b) => b.type !== 'check' && b.text.trim()).map((b) => clean(b.text));
    const terms = [...docToPlainText(doc).matchAll(/\b([A-Z][A-Z0-9-]{1,})\b/g)].map((m) => m[1]!);
    const summary: TranscriptSummary = {
      main_points: points.slice(0, 6),
      key_terms: [...new Set(terms)].slice(0, 5).map((term) => ({ term, explanation: vi.demo.termExplanation })),
      homework: open.map((b) => ({ title: clean(b.text), deadline_hint: null })),
    };
    return { status: 200, data: { summary, provider: 'demo' } };
  }
  const cols = db.table('collections').filter((c) => !c.archived) as unknown as { id: string; name: string; space: 'study' | 'work' }[];
  const tasks: ParseTaskResponse['tasks'] = [];
  for (const b of open) {
    const parsed = demoParse(clean(b.text), cols, now, 'Asia/Ho_Chi_Minh');
    for (const t of parsed.tasks)
      tasks.push({
        ...t,
        collection_id: t.collection_id ?? (note.collection_id as string | null) ?? null,
        space: note.space as 'study' | 'work',
      });
  }
  return { status: 200, data: { tasks: tasks.slice(0, 10), provider: 'demo' } };
}

export const isDemoUser = (r: Row) => r.user_id === DEMO_UID;

// ---------------------------------------------------------------------------
// split-task (rule-based steps, then the same clean-up as the real function)
// ---------------------------------------------------------------------------

export function demoSplit(db: DemoDb, body: Record<string, unknown>) {
  const task = db.table('tasks').find((t) => t.id === body.task_id);
  if (!task) return { status: 404, error: 'not_found' as const };
  const title = String(task.title);
  const study = task.space === 'study';
  const base = study
    ? ['Đọc lại slide và tài liệu liên quan', 'Lập dàn ý và chia phần', `Làm phần chính: ${title}`, 'Rà soát, sửa lỗi và hoàn thiện']
    : ['Làm rõ yêu cầu và đầu ra cần có', 'Chuẩn bị tài liệu, số liệu', `Thực hiện: ${title}`, 'Kiểm tra lại và gửi đi'];
  const existing = db
    .table('tasks')
    .filter((t) => t.parent_task_id === task.id)
    .map((t) => ({ title: String(t.title), estimate_minutes: (t.estimate_minutes as number | null) ?? null }));
  const steps = normalizeSplit(
    { steps: base.map((t, i) => ({ title: t, estimate_minutes: [20, 20, 60, 25][i] ?? 30 })) },
    { title, estimate_minutes: (task.estimate_minutes as number | null) ?? null, existing_subtasks: existing },
  );
  return { status: 200, data: { steps, provider: 'demo' } };
}
