/**
 * gcal-sync — two-way Google Calendar sync (algorithm in _shared/gcal-sync-core.ts).
 *
 *   POST {}  with a user JWT          → sync that user (app open, pull-to-refresh, "Đồng bộ ngay",
 *                                        after approving a plan / moving a block)
 *   POST { mode: 'cron' } service key → sync every connected user (pg_cron, every 15 minutes)
 */
import { env, getUser, isServiceCall, serviceClient } from '../_shared/context.ts';
import { accessTokenFor, ERR_VI, GoogleCalendar, loadConnection, markRevoked, supabaseSyncStore } from '../_shared/gcal-store.ts';
import { type SyncResult, syncUser } from '../_shared/gcal-sync-core.ts';
import { GoogleError } from '../_shared/google.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';

const FN = 'gcal-sync';

type Outcome = { ok: true; result: SyncResult } | { ok: false; code: 'gcal_not_connected' | 'gcal_revoked' | 'gcal_failed' };

async function syncOne(userId: string): Promise<Outcome> {
  const db = serviceClient();
  const conn = await loadConnection(db, userId);
  if (!conn) return { ok: false, code: 'gcal_not_connected' };
  if (!conn.target_calendar_id) {
    await db.from('google_connections').update({ status: 'error', last_error: ERR_VI.noTarget }).eq('user_id', userId);
    return { ok: false, code: 'gcal_failed' };
  }
  await db.from('google_connections').update({ status: 'syncing' }).eq('user_id', userId);
  try {
    const gcal = new GoogleCalendar(await accessTokenFor(db, userId));
    const result = await syncUser(conn, gcal, supabaseSyncStore(db, userId), { webAppUrl: env('WEB_APP_URL') });
    await db
      .from('google_connections')
      .update({ status: 'connected', last_error: null, last_synced_at: new Date().toISOString() })
      .eq('user_id', userId);
    return { ok: true, result };
  } catch (e) {
    if (e instanceof GoogleError && e.isAuthRevoked) {
      await markRevoked(db, userId);
      return { ok: false, code: 'gcal_revoked' };
    }
    log(FN, {
      event: 'sync_failed',
      status: e instanceof GoogleError ? e.status : null,
      message: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    });
    await db.from('google_connections').update({ status: 'error', last_error: ERR_VI.failed }).eq('user_id', userId);
    return { ok: false, code: 'gcal_failed' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('bad_request', 405);

  if (isServiceCall(req)) {
    const db = serviceClient();
    const { data } = await db
      .from('google_connections')
      .select('user_id')
      .in('status', ['connected', 'error', 'syncing'])
      .not('refresh_token_secret_id', 'is', null);
    let ok = 0;
    for (const row of data ?? []) if ((await syncOne(row.user_id)).ok) ok++;
    log(FN, { event: 'cron', users: data?.length ?? 0, ok });
    return json({ users: data?.length ?? 0, ok });
  }

  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const out = await syncOne(auth.user.id);
  if (!out.ok) {
    const status = out.code === 'gcal_revoked' ? 401 : out.code === 'gcal_not_connected' ? 409 : 502;
    return json({ error: out.code }, status);
  }
  log(FN, { event: 'done', ...out.result });
  return json(out.result);
});
