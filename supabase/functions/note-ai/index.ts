/**
 * note-ai — "✦ AI" in the note editor.
 *
 * POST { note_id, action } with the user's JWT:
 *   summarize      → 200 { summary: { main_points, key_terms, homework }, provider }
 *   extract_tasks  → 200 { tasks: ParsedTask[], provider }   (previews; the app creates them)
 *   401 · 404 · 403 privacy_mode (note content never goes to AI in privacy mode) · 429 ai_quota · 503 ai_unavailable
 * The note text plus transcripts of its recordings are sent; nothing is logged.
 */
import { loadHabits } from '../_shared/habits-store.ts';
import { AIError, generateStructured, SchemaError } from '../_shared/ai-provider.ts';
import { aiProviders, consumeAiCall, getUser } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import { AiExtractResponse, extractPrompt, NoteAiRequest, noteSource } from '../_shared/note-ai-core.ts';
import { type CollectionRef, finalizeParse } from '../_shared/parse-task-core.ts';
import { summarize } from '../_shared/transcribe-core.ts';
import { formatIsoTz } from '../_shared/vi-parse.ts';

const FN = 'note-ai';
const WEEKDAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);
  const started = Date.now();
  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const { user, db } = auth;

  let body: NoteAiRequest;
  try {
    const parsed = NoteAiRequest.safeParse(await req.json());
    if (!parsed.success) return errorResponse('bad_request', 400);
    body = parsed.data;
  } catch {
    return errorResponse('bad_request', 400, 'invalid JSON');
  }

  const [noteRes, profileRes] = await Promise.all([
    db.from('notes').select('id, title, plain_text, space').eq('id', body.note_id).maybeSingle(),
    db.from('profiles').select('timezone, ai_privacy_mode').eq('id', user.id).single(),
  ]);
  const note = noteRes.data;
  if (!note) return errorResponse('not_found', 404);
  if (profileRes.data?.ai_privacy_mode) return errorResponse('privacy_mode', 403);
  const tz: string = profileRes.data?.timezone ?? 'Asia/Ho_Chi_Minh';

  const providers = aiProviders();
  if (providers.length === 0) return errorResponse('ai_unavailable', 503);

  const { data: audio } = await db
    .from('attachments')
    .select('transcript_text')
    .eq('owner_type', 'note')
    .eq('owner_id', note.id)
    .eq('type', 'audio')
    .not('transcript_text', 'is', null);
  const source = noteSource(
    note.title ?? '',
    note.plain_text ?? '',
    (audio ?? []).map((a) => String(a.transcript_text ?? '')),
  );
  if (!source.trim()) return errorResponse('bad_request', 400, 'empty note');
  if (!(await consumeAiCall(user.id))) return errorResponse('ai_quota', 429);

  const habits = await loadHabits(db, tz, false);
  try {
    if (body.action === 'summarize') {
      const { summary, provider } = await summarize(
        providers,
        'note',
        note.title ?? '',
        source,
        { log: (e) => log(FN, e) },
        habits.prompt('notes'),
      );
      log(FN, { event: 'summary', provider, chars: source.length, ms: Date.now() - started });
      return json({ summary, provider });
    }
    const { data: cols } = await db.from('collections').select('id, name, space').eq('archived', false);
    const collections = (cols ?? []) as CollectionRef[];
    const now = Date.now();
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    const weekdayVi = WEEKDAYS_VI[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)] ?? '';
    const prompt = extractPrompt({
      text: source,
      nowIso: formatIsoTz(now, tz),
      weekdayVi,
      tz,
      collections,
      officeHoursSummary: 'xem cài đặt',
    });
    const res = await generateStructured(
      providers,
      AiExtractResponse,
      { ...prompt, system: prompt.system + habits.prompt('parse'), maxOutputTokens: 4096 },
      { timeoutMs: 30_000, log: (e) => log(FN, e) },
    );
    const out = finalizeParse(res.data, { text: source, now, tz, collections, url: null, provider: res.provider, alias: habits.alias });
    log(FN, { event: 'extract', provider: res.provider, tasks: out.tasks.length, ms: Date.now() - started });
    return json({ tasks: out.tasks, provider: res.provider });
  } catch (e) {
    const kind = e instanceof SchemaError ? 'schema' : e instanceof AIError ? `ai:${e.provider}:${e.status ?? 'net'}` : 'unknown';
    log(FN, { event: 'failed', kind, ms: Date.now() - started });
    return errorResponse('ai_unavailable', 503);
  }
});
