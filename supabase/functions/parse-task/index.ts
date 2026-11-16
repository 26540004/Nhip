/**
 * parse-task — Vietnamese natural-language Quick Add → structured task previews.
 *
 * POST { text } with the user's JWT. Responses:
 *  200 { tasks: ParsedTask[], url, provider }
 *  401 unauthorized · 400 bad_request · 429 ai_quota · 503 ai_unavailable (client saves to inbox as "Chưa phân tích")
 *
 * Privacy: the text typed into Quick Add is a task title, which privacy mode allows
 * (titles, durations, deadlines, times). Note content is never read here. Content is never logged.
 */
import { AIError, generateStructured, SchemaError } from '../_shared/ai-provider.ts';
import { aiProviders, consumeAiCall, getUser } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import {
  AiParseResponse,
  buildPrompt,
  type CollectionRef,
  extractUrl,
  finalizeParse,
  ParseTaskRequest,
} from '../_shared/parse-task-core.ts';
import { formatIsoTz } from '../_shared/vi-parse.ts';

const FN = 'parse-task';
const WEEKDAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);

  const started = Date.now();
  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const { user, db } = auth;

  let body: ParseTaskRequest;
  try {
    const parsed = ParseTaskRequest.safeParse(await req.json());
    if (!parsed.success) return errorResponse('bad_request', 400, parsed.error.issues[0]?.message);
    body = parsed.data;
  } catch {
    return errorResponse('bad_request', 400, 'invalid JSON');
  }

  const [profileRes, colsRes, hoursRes] = await Promise.all([
    db.from('profiles').select('timezone').eq('id', user.id).single(),
    db.from('collections').select('id, name, space').eq('archived', false),
    db.from('work_hours').select('weekday, start_time, end_time, enabled').order('weekday'),
  ]);
  const tz: string = profileRes.data?.timezone ?? 'Asia/Ho_Chi_Minh';
  const collections = (colsRes.data ?? []) as CollectionRef[];
  const hours = (hoursRes.data ?? []) as { weekday: number; start_time: string; end_time: string; enabled: boolean }[];
  const enabled = hours.filter((h) => h.enabled);
  const officeHoursSummary = enabled.length
    ? enabled.map((h) => `${WEEKDAYS_VI[h.weekday]} ${h.start_time.slice(0, 5)}–${h.end_time.slice(0, 5)}`).join(', ')
    : 'không có';

  const providers = aiProviders();
  if (providers.length === 0) return errorResponse('ai_unavailable', 503, 'no provider configured');

  if (!(await consumeAiCall(user.id))) return errorResponse('ai_quota', 429);

  const now = Date.now();
  const { url, rest } = extractUrl(body.text);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const weekdayVi = WEEKDAYS_VI[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)] ?? '';
  const prompt = buildPrompt({ text: rest || body.text, nowIso: formatIsoTz(now, tz), weekdayVi, tz, collections, officeHoursSummary });

  try {
    const res = await generateStructured(providers, AiParseResponse, prompt, {
      timeoutMs: 15_000,
      log: (e) => log(FN, e),
    });
    const out = finalizeParse(res.data, { text: rest, now, tz, collections, url, provider: res.provider });
    log(FN, { event: 'done', provider: res.provider, tasks: out.tasks.length, chars: body.text.length, ms: Date.now() - started });
    return json(out);
  } catch (e) {
    const kind = e instanceof SchemaError ? 'schema' : e instanceof AIError ? `ai:${e.provider}:${e.status ?? 'net'}` : 'unknown';
    log(FN, { event: 'failed', kind, ms: Date.now() - started });
    return errorResponse('ai_unavailable', 503);
  }
});
