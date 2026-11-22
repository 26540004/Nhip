/**
 * split-task — "✦ Chia nhỏ việc này".
 *
 * POST { task_id } with the user's JWT →
 *   200 { steps: [{ title, estimate_minutes }], provider }   (previews; the app creates subtasks)
 *   400 · 401 · 404 · 429 ai_quota · 503 ai_unavailable
 * Privacy mode: only title, estimate, deadline and existing step titles are sent (no description).
 * Nothing is logged except counts and timing.
 */
import { loadHabits } from '../_shared/habits-store.ts';
import { AIError, generateStructured, SchemaError } from '../_shared/ai-provider.ts';
import { aiProviders, consumeAiCall, getUser } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import { AiSplit, normalizeSplit, type SplitContext, splitPrompt, SplitRequest } from '../_shared/split-task-core.ts';
import { formatIsoTz } from '../_shared/vi-parse.ts';

const FN = 'split-task';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);
  const started = Date.now();
  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const { user, db } = auth;

  let taskId: string;
  try {
    const parsed = SplitRequest.safeParse(await req.json());
    if (!parsed.success) return errorResponse('bad_request', 400);
    taskId = parsed.data.task_id;
  } catch {
    return errorResponse('bad_request', 400, 'invalid JSON');
  }

  const [taskRes, subsRes, profileRes] = await Promise.all([
    db.from('tasks').select('id, title, description, estimate_minutes, deadline_at, space, collection_id').eq('id', taskId).maybeSingle(),
    db.from('tasks').select('title, estimate_minutes').eq('parent_task_id', taskId),
    db.from('profiles').select('timezone, ai_privacy_mode').eq('id', user.id).single(),
  ]);
  const task = taskRes.data;
  if (!task) return errorResponse('not_found', 404);
  const tz: string = profileRes.data?.timezone ?? 'Asia/Ho_Chi_Minh';
  let collectionName: string | null = null;
  if (task.collection_id) {
    const { data } = await db.from('collections').select('name').eq('id', task.collection_id).maybeSingle();
    collectionName = data?.name ?? null;
  }

  const providers = aiProviders();
  if (providers.length === 0) return errorResponse('ai_unavailable', 503);
  if (!(await consumeAiCall(user.id))) return errorResponse('ai_quota', 429);

  const ctx: SplitContext = {
    title: task.title,
    description: task.description ?? null,
    estimate_minutes: task.estimate_minutes ?? null,
    deadline_local: task.deadline_at ? formatIsoTz(Date.parse(task.deadline_at), tz) : null,
    space: task.space,
    collection_name: collectionName,
    existing_subtasks: (subsRes.data ?? []) as SplitContext['existing_subtasks'],
    privacy: Boolean(profileRes.data?.ai_privacy_mode),
  };

  try {
    const habits = await loadHabits(db, tz, ctx.privacy);
    const prompt = splitPrompt(ctx);
    const res = await generateStructured(
      providers,
      AiSplit,
      { ...prompt, system: prompt.system + habits.prompt('split'), maxOutputTokens: 1024 },
      { timeoutMs: 20_000, log: (e) => log(FN, e) },
    );
    const steps = normalizeSplit(res.data, ctx);
    log(FN, { event: 'done', provider: res.provider, steps: steps.length, privacy: ctx.privacy, ms: Date.now() - started });
    if (steps.length === 0) return errorResponse('ai_unavailable', 503, 'no usable steps');
    return json({ steps, provider: res.provider });
  } catch (e) {
    const kind = e instanceof SchemaError ? 'schema' : e instanceof AIError ? `ai:${e.provider}:${e.status ?? 'net'}` : 'unknown';
    log(FN, { event: 'failed', kind, ms: Date.now() - started });
    return errorResponse('ai_unavailable', 503);
  }
});
