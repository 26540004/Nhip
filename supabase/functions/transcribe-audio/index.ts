/**
 * transcribe-audio — turns a recording (uploaded in ~10-minute segments) into a timestamped
 * transcript and a summary { main_points, key_terms, homework }.
 *
 * User calls (JWT), body { attachment_id, action }:
 *   start      queue every segment of the recording (also re-queues failed ones)
 *   retry      re-queue one failed segment ({ segment_id }) or all failed segments
 *   summarize  redo the summary from the finished transcript
 *   process    nudge the queue (the app calls this after uploads and while the panel is open)
 *   → 202 { transcript_status, total, done, failed }. Work continues in the background.
 *   403 privacy_mode — audio content is never sent to AI in privacy mode.
 * Cron (service key), body { mode: "cron" }: works through due segments of all users.
 *
 * Segments are processed one at a time per recording (claim_audio_segment), with backoff on
 * rate limits and up to 3 attempts; progress lives in audio_segments so the app can show
 * "Đang xử lý đoạn 3/12" and retry a single failed segment. Content is never logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { aiProviders, consumeAiCall, getUser, isServiceCall, serviceClient, speechToText } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import {
  joinTranscript,
  progressOf,
  type RecordingMeta,
  retryDecision,
  type SegmentState,
  summarize,
  transcribeSegment,
} from '../_shared/transcribe-core.ts';
import { expiryFrom } from '../_shared/audio-retention.ts';

const FN = 'transcribe-audio';
/** Do not start another segment after this much wall time in one invocation. */
const START_BUDGET_MS = 60_000;

const Body = z.object({
  mode: z.literal('cron').optional(),
  action: z.enum(['start', 'retry', 'summarize', 'process', 'delete_audio']).optional(),
  attachment_id: z.string().uuid().optional(),
  segment_id: z.string().uuid().optional(),
});

interface SegmentRow {
  id: string;
  user_id: string;
  attachment_id: string;
  seq: number;
  storage_path: string;
  mime: string;
  start_offset_sec: number | string;
  duration_sec: number | string;
  attempts: number;
}

/** Run work after the response when the platform allows it (Supabase EdgeRuntime). */
function inBackground(p: Promise<unknown>): Promise<unknown> | null {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const guarded = p.catch((e) => log(FN, { event: 'background_error', kind: e instanceof Error ? e.name : 'unknown' }));
  if (rt?.waitUntil) {
    rt.waitUntil(guarded);
    return null;
  }
  return guarded; // local runtime: caller awaits
}

async function privacyOn(svc: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await svc.from('profiles').select('ai_privacy_mode').eq('id', userId).single();
  return Boolean(data?.ai_privacy_mode);
}

async function processSegment(svc: SupabaseClient, seg: SegmentRow): Promise<void> {
  const started = Date.now();
  const release = (patch: Record<string, unknown>) =>
    svc
      .from('audio_segments')
      .update({ claimed_at: null, ...patch })
      .eq('id', seg.id);

  if (await privacyOn(svc, seg.user_id)) {
    await release({ transcript_status: 'none', attempts: Math.max(0, seg.attempts - 1), last_error: 'privacy_mode' });
    await svc.from('attachments').update({ transcript_status: 'none' }).eq('id', seg.attachment_id);
    return;
  }
  if (!(await consumeAiCall(seg.user_id))) {
    await release({ transcript_status: 'failed', attempts: Math.max(0, seg.attempts - 1), last_error: 'ai_quota' });
    return;
  }

  const file = await svc.storage.from('attachments').download(seg.storage_path);
  if (file.error || !file.data) {
    const d = retryDecision(seg.attempts, new Error('download'));
    await release({
      transcript_status: seg.attempts >= 3 ? 'failed' : 'pending',
      next_attempt_at: new Date(Date.now() + Math.max(d.delaySec, 30) * 1000).toISOString(),
      last_error: 'download_failed',
    });
    log(FN, { event: 'download_failed', seq: seg.seq });
    return;
  }
  const bytes = new Uint8Array(await file.data.arrayBuffer());

  try {
    const out = await transcribeSegment(
      { bytes, mime: seg.mime, startOffsetSec: Number(seg.start_offset_sec), durationSec: Number(seg.duration_sec) },
      { providers: aiProviders(), whisper: speechToText(), opts: { retries: 0, timeoutMs: 90_000, log: (e) => log(FN, e) } },
    );
    await release({ transcript_status: 'done', transcript_json: out.lines, last_error: null });
    log(FN, {
      event: 'segment_done',
      seq: seg.seq,
      provider: out.provider,
      lines: out.lines.length,
      kb: Math.round(bytes.length / 1024),
      ms: Date.now() - started,
    });
  } catch (e) {
    const d = retryDecision(seg.attempts, e);
    await release({
      transcript_status: d.status,
      next_attempt_at: new Date(Date.now() + d.delaySec * 1000).toISOString(),
      attempts: d.refundAttempt ? Math.max(0, seg.attempts - 1) : seg.attempts,
      last_error: d.reason,
    });
    log(FN, { event: 'segment_failed', seq: seg.seq, reason: d.reason, next: d.status, ms: Date.now() - started });
  }
}

/** When every segment has finished: join the transcript and summarise (once). */
async function maybeFinalize(svc: SupabaseClient, attachmentId: string, forceSummary = false): Promise<void> {
  const { data: att } = await svc
    .from('attachments')
    .select('id, user_id, owner_type, owner_id, title, meta_json, transcript_status, summary_json')
    .eq('id', attachmentId)
    .single();
  if (!att || att.transcript_status === 'none') return;
  const { data: segs } = await svc
    .from('audio_segments')
    .select('seq, uploaded, transcript_status, transcript_json, start_offset_sec')
    .eq('attachment_id', attachmentId)
    .order('seq');
  const segments = (segs ?? []) as SegmentState[];
  const p = progressOf((att.meta_json ?? {}) as RecordingMeta, segments);
  if (!p.complete) return;

  const { text } = joinTranscript(segments);
  if (p.failed > 0) {
    await svc
      .from('attachments')
      .update({ transcript_status: 'failed', transcript_text: text || null })
      .eq('id', attachmentId);
    return;
  }
  const already = att.transcript_status === 'done' && att.summary_json && !forceSummary;
  await svc.from('attachments').update({ transcript_status: 'done', transcript_text: text }).eq('id', attachmentId);
  // Transcript complete: the audio may now go, automatically after 14 days (countdown in the app).
  await svc
    .from('attachments')
    .update({ audio_expires_at: expiryFrom(Date.now()) })
    .eq('id', attachmentId)
    .is('audio_expires_at', null)
    .is('audio_deleted_at', null);
  if (already) return;

  if (!text.trim()) {
    await svc
      .from('attachments')
      .update({ summary_json: { main_points: [], key_terms: [], homework: [] } })
      .eq('id', attachmentId);
    return;
  }
  if ((await privacyOn(svc, att.user_id)) || !(await consumeAiCall(att.user_id))) return;

  let title = att.title ?? '';
  if (att.owner_type === 'note') {
    const { data: note } = await svc.from('notes').select('title').eq('id', att.owner_id).single();
    title = note?.title || title;
  }
  try {
    const { summary, provider } = await summarize(aiProviders(), 'recording', title, text, { log: (e) => log(FN, e) });
    await svc.from('attachments').update({ summary_json: summary }).eq('id', attachmentId);
    log(FN, { event: 'summary_done', provider, points: summary.main_points.length, homework: summary.homework.length });
  } catch (e) {
    // Transcript stays usable; the app offers "Tóm tắt lại".
    log(FN, { event: 'summary_failed', kind: e instanceof Error ? e.name : 'unknown' });
  }
}

/**
 * Delete a recording's audio files, keeping transcript, summary and segment rows.
 * Only after a complete transcript; never touches a failed one (its audio is needed to retry).
 */
async function purgeAudio(svc: SupabaseClient, attachmentId: string): Promise<boolean> {
  const { data: att } = await svc
    .from('attachments')
    .select('id, user_id, storage_path, transcript_status, audio_deleted_at')
    .eq('id', attachmentId)
    .single();
  if (!att || att.audio_deleted_at || att.transcript_status !== 'done') return false;
  const { data: segs } = await svc.from('audio_segments').select('storage_path').eq('attachment_id', attachmentId);
  const paths = [
    ...new Set([...(segs ?? []).map((x: { storage_path: string }) => x.storage_path), att.storage_path].filter(Boolean)),
  ].filter(
    (path) => String(path).split('/')[0] === att.user_id, // never outside the owner's folder
  ) as string[];
  if (paths.length) {
    const { error } = await svc.storage.from('attachments').remove(paths);
    if (error) {
      log(FN, { event: 'purge_failed', files: paths.length });
      return false;
    }
  }
  await svc.from('attachments').update({ audio_deleted_at: new Date().toISOString(), audio_expires_at: null }).eq('id', attachmentId);
  log(FN, { event: 'audio_purged', files: paths.length });
  return true;
}

async function purgeExpired(svc: SupabaseClient): Promise<number> {
  const { data } = await svc
    .from('attachments')
    .select('id')
    .eq('type', 'audio')
    .is('audio_deleted_at', null)
    .lte('audio_expires_at', new Date().toISOString())
    .limit(20);
  let n = 0;
  for (const a of data ?? []) if (await purgeAudio(svc, a.id)) n++;
  return n;
}

async function drain(svc: SupabaseClient, attachmentId: string | null): Promise<number> {
  const started = Date.now();
  let processed = 0;
  const touched = new Set<string>();
  while (Date.now() - started < START_BUDGET_MS) {
    const { data, error } = await svc.rpc('claim_audio_segment', { p_attachment: attachmentId });
    if (error) throw error;
    const seg = (data as SegmentRow[] | null)?.[0];
    if (!seg) break;
    await processSegment(svc, seg);
    touched.add(seg.attachment_id);
    processed++;
    await maybeFinalize(svc, seg.attachment_id);
  }
  if (attachmentId && !touched.has(attachmentId)) await maybeFinalize(svc, attachmentId);
  return processed;
}

async function snapshot(svc: SupabaseClient, attachmentId: string) {
  const [{ data: att }, { data: segs }] = await Promise.all([
    svc.from('attachments').select('transcript_status, meta_json').eq('id', attachmentId).single(),
    svc
      .from('audio_segments')
      .select('seq, uploaded, transcript_status, transcript_json, start_offset_sec')
      .eq('attachment_id', attachmentId),
  ]);
  const p = progressOf((att?.meta_json ?? {}) as RecordingMeta, (segs ?? []) as SegmentState[]);
  return { transcript_status: att?.transcript_status ?? 'none', total: p.total, done: p.done, failed: p.failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse('bad_request', 400);
    body = parsed.data;
  } catch {
    return errorResponse('bad_request', 400);
  }
  const svc = serviceClient();

  if (isServiceCall(req)) {
    const work = async () => {
      const n = await drain(svc, null);
      // Recordings whose last segment finished before the app saved "recording: done".
      const { data: open } = await svc
        .from('attachments')
        .select('id')
        .eq('type', 'audio')
        .eq('transcript_status', 'processing')
        .gt('updated_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
        .limit(20);
      for (const a of open ?? []) await maybeFinalize(svc, a.id);
      const purged = await purgeExpired(svc);
      log(FN, { event: 'cron', processed: n, open: open?.length ?? 0, purged });
    };
    const pending = inBackground(work());
    if (pending) await pending;
    return json({ ok: true }, 202);
  }

  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const { user, db } = auth;
  if (!body.attachment_id) return errorResponse('bad_request', 400, 'attachment_id required');
  const action = body.action ?? 'process';

  // RLS: only the owner can see the attachment.
  const { data: att } = await db
    .from('attachments')
    .select('id, type, transcript_status, audio_deleted_at')
    .eq('id', body.attachment_id)
    .maybeSingle();
  if (!att) return errorResponse('not_found', 404);
  if (att.type !== 'audio') return errorResponse('bad_request', 400, 'not an audio attachment');
  // "Xoá âm thanh ngay": no AI involved, so allowed in privacy mode too.
  if (action === 'delete_audio') {
    if (att.audio_deleted_at) return json({ audio_deleted_at: att.audio_deleted_at }, 200);
    if (att.transcript_status !== 'done') return errorResponse('not_ready', 409);
    if (!(await purgeAudio(svc, att.id))) return errorResponse('internal', 500);
    log(FN, { event: 'request', action });
    return json({ audio_deleted_at: new Date().toISOString() }, 200);
  }
  if (att.audio_deleted_at && action !== 'summarize') return errorResponse('audio_deleted', 409);
  if (await privacyOn(svc, user.id)) return errorResponse('privacy_mode', 403);
  if (aiProviders().filter((p) => p.supportsAudio).length === 0 && !speechToText()) return errorResponse('ai_unavailable', 503);

  const now = new Date().toISOString();
  if (action === 'start') {
    await svc.from('attachments').update({ transcript_status: 'processing' }).eq('id', att.id);
    await svc
      .from('audio_segments')
      .update({ transcript_status: 'pending', attempts: 0, last_error: null, next_attempt_at: now, claimed_at: null })
      .eq('attachment_id', att.id)
      .in('transcript_status', ['none', 'failed']);
  } else if (action === 'retry') {
    let q = svc
      .from('audio_segments')
      .update({ transcript_status: 'pending', attempts: 0, last_error: null, next_attempt_at: now, claimed_at: null })
      .eq('attachment_id', att.id)
      .eq('transcript_status', 'failed');
    if (body.segment_id) q = q.eq('id', body.segment_id);
    await q;
    await svc.from('attachments').update({ transcript_status: 'processing' }).eq('id', att.id);
  } else if (action === 'summarize') {
    if (att.transcript_status !== 'done') return errorResponse('not_ready', 409);
    await svc.from('attachments').update({ summary_json: null }).eq('id', att.id);
  }

  const work =
    action === 'summarize'
      ? maybeFinalize(svc, att.id, true)
      : att.transcript_status === 'none' && action === 'process'
        ? Promise.resolve()
        : drain(svc, att.id);
  const pending = inBackground(work);
  if (pending) await pending;
  log(FN, { event: 'request', action });
  return json(await snapshot(svc, att.id), 202);
});
