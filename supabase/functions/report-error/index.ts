/**
 * report-error — the admin's Nhịp reports a bug; Claude (GitHub Action, admin's Pro plan) fixes it.
 *
 * POST <ReportInput> with the user's JWT →
 *   202 { fingerprint, issue: number | null, stored: true }
 *   400 · 401 · 403 not_admin · 429 (hourly budget)
 *
 * - Admin only (public.app_admins). Everyone else: 403, nothing stored.
 * - Everything is scrubbed (error-report-core) before it is stored or leaves the server.
 * - Repeats of the same bug update one row / one issue (comment on milestone repeats only).
 * - Issues are created ONLY in a private repository: if GITHUB_REPO is public, missing or
 *   unreachable, the report stays in the database (error_reports) and no issue is made.
 * Secrets: GITHUB_ISSUES_TOKEN (fine-grained, this repo, Issues: read & write), GITHUB_REPO (owner/name).
 */
import { getUser, serviceClient } from '../_shared/context.ts';
import { cleanReport, issueBody, issueTitle, ReportInput, shouldComment } from '../_shared/error-report-core.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';

const FN = 'report-error';
const HOURLY_BUDGET = 30;
const GH = Deno.env.get('GITHUB_API_URL') ?? 'https://api.github.com';

async function github(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = Deno.env.get('GITHUB_ISSUES_TOKEN');
  if (!token) return null;
  try {
    return await fetch(`${GH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'nhip-report-error',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}

/** Only ever post to a private repository: reports describe how the admin uses the app. */
async function privateRepo(repo: string): Promise<boolean> {
  const r = await github(`/repos/${repo}`);
  if (!r?.ok) return false;
  const j = (await r.json()) as { private?: boolean };
  return j.private === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);
  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const { db } = auth;

  const admin = await db.rpc('is_admin');
  if (admin.data !== true) return errorResponse('not_admin', 403);

  let input: ReportInput;
  try {
    const parsed = ReportInput.safeParse(await req.json());
    if (!parsed.success) return errorResponse('bad_request', 400);
    input = parsed.data;
  } catch {
    return errorResponse('bad_request', 400, 'invalid JSON');
  }

  const svc = serviceClient();
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
  const { data: used } = await svc.from('error_report_budget').select('n').eq('hour', hour).maybeSingle();
  if ((used?.n ?? 0) >= HOURLY_BUDGET) return errorResponse('rate_limited', 429);
  await svc.from('error_report_budget').upsert({ hour, n: (used?.n ?? 0) + 1 });

  const c = cleanReport(input);
  const title = issueTitle(c);
  const body = issueBody(c);
  const { data: prev } = await svc
    .from('error_reports')
    .select('count, issue_number, last_comment_at')
    .eq('fingerprint', c.fingerprint)
    .maybeSingle();
  const count = (prev?.count ?? 0) + 1;
  await svc.from('error_reports').upsert({
    fingerprint: c.fingerprint,
    kind: c.kind,
    title,
    body,
    count,
    last_seen: new Date().toISOString(),
    ...(prev ? {} : { first_seen: new Date().toISOString() }),
  });

  let issue: number | null = prev?.issue_number ?? null;
  const repo = Deno.env.get('GITHUB_REPO') ?? '';
  if (/^[\w.-]+\/[\w.-]+$/.test(repo) && (await privateRepo(repo))) {
    if (!issue) {
      const r = await github(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['auto-bug'] }) });
      if (r?.ok) {
        issue = ((await r.json()) as { number: number }).number;
        await svc.from('error_reports').update({ issue_number: issue }).eq('fingerprint', c.fingerprint);
      }
    } else if (shouldComment(count) || c.kind === 'manual') {
      const extra = c.kind === 'manual' && c.description ? `\n\n> ${c.description.replace(/\n/g, '\n> ')}` : '';
      const r = await github(`/repos/${repo}/issues/${issue}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: `Lỗi này lặp lại lần thứ ${count} (${c.app_version} · ${c.platform}).${extra}` }),
      });
      if (r?.ok) await svc.from('error_reports').update({ last_comment_at: new Date().toISOString() }).eq('fingerprint', c.fingerprint);
    }
  } else {
    log(FN, { event: 'issue_skipped', reason: repo ? 'repo_not_private_or_unreachable' : 'no_repo' });
  }

  log(FN, { event: 'reported', kind: c.kind, count, issue: issue != null });
  return json({ fingerprint: c.fingerprint, issue, stored: true }, 202);
});
