/**
 * propose-plan — AI proposes, code validates (spec §I.2).
 *
 * POST { range: 'today'|'tomorrow'|'week', task_ids?, rebalance_date? } with the user's JWT.
 * → 200 { proposal_id, summary, source: 'ai'|'fallback', warnings, blocks }
 *
 * Nothing is written to Google here: blocks are stored as 'proposed' and only reach Google
 * Calendar after the user approves them on the review screen (then gcal-sync pushes them).
 * In privacy mode the AI receives only titles (≤ 60 chars), durations, deadlines and free
 * time slots. Logs never contain titles.
 */
import { AIError, generateStructured, SchemaError } from '../_shared/ai-provider.ts';
import { aiProviders, consumeAiCall, getUser, serviceClient } from '../_shared/context.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import { viCore } from '../_shared/planning/strings.ts';
import type { Weekday } from '../_shared/planning/tz.ts';
import {
  type AiPlanResponse,
  AiPlanResponse as AiPlanSchema,
  type BlockRow,
  buildPlanContext,
  buildPlanPrompt,
  finalizePlan,
  type PlanInputs,
  ProposePlanRequest,
  type TaskRow,
} from '../_shared/propose-plan-core.ts';

const FN = 'propose-plan';
const hm = (t: string) => t.slice(0, 5);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);
  const started = Date.now();

  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const parsed = ProposePlanRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse('bad_request', 400, parsed.error.issues[0]?.message);
  const request = parsed.data;
  const { user, db } = auth; // RLS-scoped reads

  const now = Date.now();
  const horizonIso = new Date(now + 40 * 86_400_000).toISOString();
  const [profile, tasks, blocks, busy, wh, sw, cs, ex, cap, rem] = await Promise.all([
    db.from('profiles').select('timezone, ai_privacy_mode').eq('id', user.id).single(),
    db
      .from('tasks')
      .select('id, parent_task_id, title, space, deadline_at, estimate_minutes, priority, status, created_at')
      .in('status', ['todo', 'doing'])
      .limit(1000),
    db
      .from('task_blocks')
      .select('id, task_id, start_at, end_at, status')
      .in('status', ['accepted', 'synced', 'conflict'])
      .gt('end_at', new Date(now - 86_400_000).toISOString()),
    db
      .from('busy_cache')
      .select('start_at, end_at, all_day')
      .eq('all_day', false)
      .lt('start_at', horizonIso)
      .gt('end_at', new Date(now).toISOString()),
    db.from('work_hours').select('weekday, start_time, end_time, break_start, break_end, enabled'),
    db.from('study_windows').select('weekday, start_time, end_time'),
    db.from('class_sessions').select('id, weekday, start_time, end_time, valid_from, valid_to'),
    db.from('schedule_exceptions').select('class_session_id, date, type, new_start_at, new_end_at'),
    db.from('capacity_settings').select('space, weekday, max_focus_minutes'),
    db.from('reminder_settings').select('quiet_start, quiet_end').maybeSingle(),
  ]);
  const err = [tasks, blocks, busy, wh, sw, cs, ex, cap].find((r) => r.error)?.error;
  if (err || profile.error) return errorResponse('internal', 500);

  const tz: string = profile.data.timezone ?? 'Asia/Ho_Chi_Minh';
  const privacyMode: boolean = profile.data.ai_privacy_mode ?? false;
  // All blocks already in the app (incl. ones we will not touch) count for "remaining minutes".
  const allBlocks = (blocks.data ?? []) as BlockRow[];

  const input: PlanInputs = {
    now,
    tz,
    request,
    tasks: (tasks.data ?? []) as TaskRow[],
    blocks: allBlocks,
    busy: (busy.data ?? []).map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) })),
    rules: {
      workHours: (wh.data ?? []).map((w) => ({
        weekday: w.weekday as Weekday,
        start: hm(w.start_time),
        end: hm(w.end_time),
        breakStart: w.break_start ? hm(w.break_start) : null,
        breakEnd: w.break_end ? hm(w.break_end) : null,
        enabled: w.enabled,
      })),
      studyWindows: (sw.data ?? []).map((w) => ({ weekday: w.weekday as Weekday, start: hm(w.start_time), end: hm(w.end_time) })),
      classSessions: (cs.data ?? []).map((c) => ({
        id: c.id,
        weekday: c.weekday as Weekday,
        start: hm(c.start_time),
        end: hm(c.end_time),
        validFrom: c.valid_from,
        validTo: c.valid_to,
      })),
      exceptions: (ex.data ?? []).map((e) => ({
        classSessionId: e.class_session_id,
        date: e.date,
        type: e.type,
        newStart: e.new_start_at ? Date.parse(e.new_start_at) : null,
        newEnd: e.new_end_at ? Date.parse(e.new_end_at) : null,
      })),
      quietHours: rem.data?.quiet_start && rem.data?.quiet_end ? { start: hm(rem.data.quiet_start), end: hm(rem.data.quiet_end) } : null,
    },
    capacity: (cap.data ?? []).map((c) => ({ space: c.space, weekday: c.weekday as Weekday, maxFocusMinutes: c.max_focus_minutes })),
    privacyMode,
  };

  const pc = buildPlanContext(input);
  if (pc.tasks.length === 0) return errorResponse('no_tasks', 422);

  // AI first (if configured and within quota); any failure → deterministic fallback.
  let ai: AiPlanResponse | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  const providers = aiProviders();
  if (providers.length && (await consumeAiCall(user.id))) {
    try {
      const res = await generateStructured(providers, AiPlanSchema, buildPlanPrompt(pc, input), {
        timeoutMs: 25_000,
        log: (e) => log(FN, e),
      });
      ai = res.data;
      provider = res.provider;
      model = res.model;
    } catch (e) {
      log(FN, {
        event: 'ai_failed',
        kind: e instanceof SchemaError ? 'schema' : e instanceof AIError ? `${e.provider}:${e.status ?? 'net'}` : 'unknown',
      });
    }
  }

  const outcome = finalizePlan(pc, ai, input.capacity);
  // Tell the user when the AI could not be used and the plan is rule-based.
  const notice = outcome.source === 'fallback' ? viCore.plan.warning.aiUnavailable : null;

  // Persist proposal + proposed blocks (service role, user_id set explicitly).
  const svc = serviceClient();
  // A new proposal supersedes older unreviewed ones (their dashed blocks disappear).
  const { data: stale } = await svc.from('ai_proposals').select('id').eq('user_id', user.id).eq('status', 'pending');
  if (stale?.length) {
    const ids = stale.map((s) => s.id);
    await svc.from('task_blocks').update({ status: 'rejected' }).eq('user_id', user.id).eq('status', 'proposed').in('proposal_id', ids);
    await svc.from('ai_proposals').update({ status: 'reviewed' }).in('id', ids);
  }
  const { data: proposal, error: pErr } = await svc
    .from('ai_proposals')
    .insert({
      user_id: user.id,
      range_start: new Date(pc.ctx.range.start).toISOString(),
      range_end: new Date(pc.ctx.range.end).toISOString(),
      request_context_json: {
        request,
        privacy_mode: privacyMode,
        task_count: pc.tasks.length,
        replaces_block_ids: pc.replaces,
      },
      response_json: ai,
      validation_report_json: {
        source: outcome.source,
        summary: outcome.summary,
        notice,
        warnings: outcome.warnings,
        stats: outcome.stats,
      },
      provider,
      model,
      status: 'pending',
    })
    .select('id')
    .single();
  if (pErr || !proposal) return errorResponse('internal', 500);

  if (outcome.blocks.length) {
    const { error: bErr } = await svc.from('task_blocks').insert(
      outcome.blocks.map((b) => ({
        user_id: user.id,
        task_id: b.taskId,
        start_at: new Date(b.start).toISOString(),
        end_at: new Date(b.end).toISOString(),
        status: 'proposed',
        proposal_id: proposal.id,
        reason: b.reason ?? null,
      })),
    );
    if (bErr) return errorResponse('internal', 500);
  }

  log(FN, {
    event: 'done',
    source: outcome.source,
    provider,
    tasks: pc.tasks.length,
    ...outcome.stats,
    warnings: outcome.warnings.length,
    ms: Date.now() - started,
  });
  return json({
    proposal_id: proposal.id,
    summary: outcome.summary,
    notice,
    source: outcome.source,
    warnings: outcome.warnings,
    replaces_block_ids: pc.replaces,
  });
});
