/**
 * learn-style — "Nhập ghi chú cũ" on the "Nhịp hiểu về bạn" page.
 *
 * POST { text } with the user's JWT →
 *   200 { terms: [{ short, meaning, collection_id }], provider }   (suggestions; nothing saved)
 *   400 · 401 · 403 privacy_mode · 429 ai_quota · 503 ai_unavailable
 * The pasted text is sent to the AI once and never stored or logged (counts only).
 */
import { AIError, generateStructured, SchemaError } from '../_shared/ai-provider.ts';
import { aiProviders, consumeAiCall, getUser } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import { AiLearn, LearnRequest, learnPrompt, normalizeLearn } from '../_shared/learn-style-core.ts';

const FN = 'learn-style';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);
  const started = Date.now();
  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const { user, db } = auth;

  let text: string;
  try {
    const parsed = LearnRequest.safeParse(await req.json());
    if (!parsed.success) return errorResponse('bad_request', 400);
    text = parsed.data.text;
  } catch {
    return errorResponse('bad_request', 400, 'invalid JSON');
  }

  const [profileRes, colsRes, vocabRes] = await Promise.all([
    db.from('profiles').select('ai_privacy_mode').eq('id', user.id).single(),
    db.from('collections').select('id, name').eq('archived', false),
    db.from('vocab_entries').select('short'),
  ]);
  // Privacy mode means note content never goes to AI.
  if (profileRes.data?.ai_privacy_mode) return errorResponse('privacy_mode', 403);

  const providers = aiProviders();
  if (providers.length === 0) return errorResponse('ai_unavailable', 503);
  if (!(await consumeAiCall(user.id))) return errorResponse('ai_quota', 429);

  const collections = (colsRes.data ?? []) as { id: string; name: string }[];
  try {
    const res = await generateStructured(
      providers,
      AiLearn,
      { ...learnPrompt(text, collections), maxOutputTokens: 2048 },
      { timeoutMs: 30_000, log: (e) => log(FN, e) },
    );
    const terms = normalizeLearn(
      res.data,
      text,
      collections,
      (vocabRes.data ?? []).map((v: { short: string }) => v.short),
    );
    log(FN, { event: 'done', provider: res.provider, terms: terms.length, chars: text.length, ms: Date.now() - started });
    return json({ terms, provider: res.provider });
  } catch (e) {
    const kind = e instanceof SchemaError ? 'schema' : e instanceof AIError ? `ai:${e.provider}:${e.status ?? 'net'}` : 'unknown';
    log(FN, { event: 'failed', kind, ms: Date.now() - started });
    return errorResponse('ai_unavailable', 503);
  }
});
