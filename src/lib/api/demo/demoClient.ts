/**
 * A Supabase-shaped client for the browser demo. Only the surface the app uses is provided.
 * Edge Functions are emulated locally:
 *  - parse-task   → rule-based parser (no AI)
 *  - propose-plan → the real shared planning core (buildPlanContext + finalizePlan without AI)
 *  - gcal-*       → "not available in the demo"
 */
import {
  type BlockRow,
  buildPlanContext,
  finalizePlan,
  type PlanInputs,
  ProposePlanRequest,
  type TaskRow,
} from '../../../../supabase/functions/_shared/propose-plan-core.ts';
import { normalizeVi } from '../../../../supabase/functions/_shared/vi-parse.ts';
import { vi } from '../../../i18n/vi';
import { rulesFromSettings } from '../../settings/rules';
import type { SettingsBundle } from '../queries';
import { DEMO_UID, DemoDb, query, type Row } from './demoDb';
import { demoParse } from './demoParse';
import { seedDemo } from './seed';

export const demoDb = new DemoDb(() => seedDemo());

const session = {
  access_token: 'demo',
  refresh_token: 'demo',
  expires_in: 10 * 365 * 86400,
  expires_at: Math.floor(Date.now() / 1000) + 10 * 365 * 86400,
  token_type: 'bearer',
  user: {
    id: DEMO_UID,
    email: 'demo@nhip.app',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: { full_name: 'Bạn' },
    created_at: new Date().toISOString(),
  },
};

function fnError(code: string, status: number) {
  return {
    data: null,
    error: { name: 'FunctionsHttpError', message: code, context: new Response(JSON.stringify({ error: code }), { status }) },
  };
}

function settingsBundle(): SettingsBundle {
  const t = demoDb.tables;
  return {
    profile: (t.profiles?.[0] ?? null) as SettingsBundle['profile'],
    workHours: (t.work_hours ?? []) as unknown as SettingsBundle['workHours'],
    studyWindows: (t.study_windows ?? []) as unknown as SettingsBundle['studyWindows'],
    classSessions: (t.class_sessions ?? []) as unknown as SettingsBundle['classSessions'],
    exceptions: (t.schedule_exceptions ?? []) as unknown as SettingsBundle['exceptions'],
    capacity: (t.capacity_settings ?? []) as unknown as SettingsBundle['capacity'],
    reminders: (t.reminder_settings?.[0] ?? null) as SettingsBundle['reminders'],
  };
}

function proposePlanLocal(body: unknown) {
  const parsed = ProposePlanRequest.safeParse(body ?? {});
  if (!parsed.success) return fnError('bad_request', 400);
  const now = Date.now();
  const rules = rulesFromSettings(settingsBundle());
  const t = demoDb.tables;
  const input: PlanInputs = {
    now,
    tz: rules.tz,
    request: parsed.data,
    tasks: (t.tasks ?? []).filter((x) => x.status === 'todo' || x.status === 'doing') as unknown as TaskRow[],
    blocks: (t.task_blocks ?? []).filter(
      (b) => ['accepted', 'synced', 'conflict'].includes(String(b.status)) && Date.parse(String(b.end_at)) > now - 86_400_000,
    ) as unknown as BlockRow[],
    busy: (t.busy_cache ?? [])
      .filter((b) => !b.all_day)
      .map((b) => ({ start: Date.parse(String(b.start_at)), end: Date.parse(String(b.end_at)) })),
    rules: {
      workHours: rules.workHours,
      studyWindows: rules.studyWindows,
      classSessions: rules.classSessions,
      exceptions: rules.exceptions,
      quietHours: rules.quietHours,
    },
    capacity: rules.capacity,
    privacyMode: false,
  };
  const pc = buildPlanContext(input);
  if (pc.tasks.length === 0) return fnError('no_tasks', 422);
  const outcome = finalizePlan(pc, null, input.capacity);
  const notice = vi.demo.planNotice;

  // Supersede older pending proposals, like the server does.
  for (const p of demoDb.table('ai_proposals').filter((p) => p.status === 'pending')) {
    p.status = 'reviewed';
    for (const b of demoDb.table('task_blocks')) if (b.proposal_id === p.id && b.status === 'proposed') b.status = 'rejected';
  }
  const proposal = demoDb.newRow('ai_proposals', {
    range_start: new Date(pc.ctx.range.start).toISOString(),
    range_end: new Date(pc.ctx.range.end).toISOString(),
    request_context_json: { request: parsed.data, privacy_mode: false, task_count: pc.tasks.length, replaces_block_ids: pc.replaces },
    validation_report_json: { source: outcome.source, summary: outcome.summary, notice, warnings: outcome.warnings, stats: outcome.stats },
    status: 'pending',
  });
  demoDb.table('ai_proposals').push(proposal);
  for (const b of outcome.blocks) {
    demoDb.table('task_blocks').push(
      demoDb.newRow('task_blocks', {
        task_id: b.taskId,
        start_at: new Date(b.start).toISOString(),
        end_at: new Date(b.end).toISOString(),
        status: 'proposed',
        proposal_id: proposal.id,
        reason: b.reason ?? null,
      }),
    );
  }
  demoDb.save();
  return {
    data: {
      proposal_id: proposal.id,
      summary: outcome.summary,
      notice,
      source: outcome.source,
      warnings: outcome.warnings,
      replaces_block_ids: pc.replaces,
    },
    error: null,
  };
}

function searchLocal(q: string): Row[] {
  const tokens = normalizeVi(q)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  const matches = (text: string) => {
    const words = normalizeVi(text).split(/[^a-z0-9]+/);
    return tokens.every((tok) => words.some((w) => w.startsWith(tok)));
  };
  const out: Row[] = [];
  for (const t of demoDb.table('tasks')) {
    if (matches(`${t.title} ${t.description ?? ''}`))
      out.push({ kind: 'task', id: t.id, owner_id: null, title: t.title, snippet: t.description ?? '', rank: 1, updated_at: t.updated_at });
  }
  for (const n of demoDb.table('notes')) {
    if (matches(`${n.title} ${n.plain_text}`))
      out.push({
        kind: 'note',
        id: n.id,
        owner_id: null,
        title: n.title,
        snippet: String(n.plain_text).slice(0, 160),
        rank: 1,
        updated_at: n.updated_at,
      });
  }
  return out.slice(0, 40);
}

export function createDemoClient() {
  return {
    from: (table: string) => query(demoDb, table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'search_all') return { data: searchLocal(String(args.q ?? '')), error: null };
      return { data: null, error: { message: `rpc ${fn} not available in demo` } };
    },
    functions: {
      invoke: async (name: string, opts: { body?: Record<string, unknown> } = {}) => {
        await new Promise((r) => setTimeout(r, 350)); // feel like a network call
        if (name === 'parse-task') {
          const text = String(opts.body?.text ?? '');
          if (!text.trim()) return fnError('bad_request', 400);
          const cols = demoDb.table('collections').filter((c) => !c.archived) as unknown as {
            id: string;
            name: string;
            space: 'study' | 'work';
          }[];
          return { data: demoParse(text, cols, Date.now(), 'Asia/Ho_Chi_Minh'), error: null };
        }
        if (name === 'propose-plan') return proposePlanLocal(opts.body);
        if (name.startsWith('gcal-')) return fnError('demo_unavailable', 409);
        return fnError('internal', 404);
      },
    },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: async () => {
        demoDb.reset();
        return { error: null };
      },
      signInWithOAuth: async () => ({ data: { url: null }, error: null }),
      signInWithIdToken: async () => ({ data: { session }, error: null }),
      exchangeCodeForSession: async () => ({ data: { session }, error: null }),
      updateUser: async () => ({ data: { user: session.user }, error: null }),
    },
  };
}
