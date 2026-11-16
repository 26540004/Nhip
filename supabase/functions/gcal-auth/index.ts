/**
 * gcal-auth — connect / disconnect Google Calendar.
 *
 *   POST { action: 'start', return_to }   (user JWT) → { url }   open in a browser
 *   GET  /gcal-auth/callback?code&state    (Google)   → 302 to return_to?gcal=connected|error
 *   POST { action: 'calendars' }          (user JWT) → { calendars: [...] }
 *   POST { action: 'disconnect' }         (user JWT) → { ok: true }
 *
 * Deploy with --no-verify-jwt (Google's redirect carries no Supabase JWT); every POST
 * action verifies the user's JWT itself, the callback verifies an HMAC-signed state.
 * The refresh token is stored in Supabase Vault and never returned to the client.
 */
import { z } from 'zod';
import { env, getUser, serviceClient } from '../_shared/context.ts';
import { accessTokenFor, GoogleCalendar, markRevoked, oauthConfig, stateSecret } from '../_shared/gcal-store.ts';
import {
  buildAuthUrl,
  emailFromIdToken,
  exchangeCode,
  GoogleError,
  isAllowedReturnUrl,
  revokeToken,
  signState,
  verifyState,
} from '../_shared/google.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';

const FN = 'gcal-auth';
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), return_to: z.string().min(1).max(500) }),
  z.object({ action: z.literal('calendars') }),
  z.object({ action: z.literal('disconnect') }),
]);

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

async function handleCallback(url: URL): Promise<Response> {
  const state = await verifyState(url.searchParams.get('state') ?? '', stateSecret());
  if (!state) return new Response('Liên kết đăng nhập Google đã hết hạn. Hãy thử kết nối lại trong Nhịp.', { status: 400 });
  const back = (status: string) => redirect(withParam(state.ret, 'gcal', status));
  if (url.searchParams.get('error')) return back('cancelled');
  const code = url.searchParams.get('code');
  if (!code) return back('error');

  const db = serviceClient();
  try {
    const tokens = await exchangeCode(oauthConfig(), code);
    if (!tokens.refresh_token) return back('error');
    const { error: storeErr } = await db.rpc('store_google_refresh_token', { p_user: state.uid, p_token: tokens.refresh_token });
    if (storeErr) throw storeErr;

    const gcal = new GoogleCalendar(tokens.access_token);
    const [{ data: conn }, { data: profile }] = await Promise.all([
      db.from('google_connections').select('target_calendar_id, read_calendar_ids').eq('user_id', state.uid).single(),
      db.from('profiles').select('timezone').eq('id', state.uid).single(),
    ]);
    // Reuse the "Nhịp" calendar if it still exists, otherwise create it.
    let target: string | null = conn?.target_calendar_id ?? null;
    if (!target || !(await gcal.calendarExists(target))) {
      target = (await gcal.createCalendar('Nhịp', profile?.timezone ?? 'Asia/Ho_Chi_Minh')).id;
    }
    await db
      .from('google_connections')
      .update({
        google_email: emailFromIdToken(tokens.id_token),
        scopes: tokens.scope.split(' '),
        target_calendar_id: target,
        read_calendar_ids: conn?.read_calendar_ids?.length ? conn.read_calendar_ids : ['primary'],
        sync_tokens_json: {},
        status: 'connected',
        last_error: null,
      })
      .eq('user_id', state.uid);
    log(FN, { event: 'connected' });
    return back('connected');
  } catch (e) {
    log(FN, { event: 'callback_failed', status: e instanceof GoogleError ? e.status : null });
    return back('error');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) return handleCallback(url);
  if (req.method !== 'POST') return errorResponse('bad_request', 405);

  const auth = await getUser(req);
  if (!auth) return errorResponse('unauthorized', 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('bad_request', 400);
  const body = parsed.data;
  const db = serviceClient();
  const uid = auth.user.id;

  if (body.action === 'start') {
    if (!isAllowedReturnUrl(body.return_to, env('WEB_APP_URL'))) return errorResponse('bad_request', 400, 'return_to');
    const state = await signState({ uid, ret: body.return_to, exp: Date.now() + 10 * 60_000, n: crypto.randomUUID() }, stateSecret());
    return json({ url: buildAuthUrl(oauthConfig(), state) });
  }

  if (body.action === 'calendars') {
    try {
      const gcal = new GoogleCalendar(await accessTokenFor(db, uid));
      const { data: conn } = await db.from('google_connections').select('target_calendar_id').eq('user_id', uid).single();
      const list = await gcal.listCalendars();
      return json({
        calendars: list.map((c) => ({
          id: c.id,
          summary: c.summary,
          primary: Boolean(c.primary),
          color: c.backgroundColor ?? null,
          is_target: c.id === conn?.target_calendar_id,
        })),
      });
    } catch (e) {
      if (e instanceof GoogleError && e.isAuthRevoked) {
        await markRevoked(db, uid);
        return errorResponse('gcal_revoked', 401);
      }
      return errorResponse('internal', 502);
    }
  }

  // disconnect
  const { data: token } = await db.rpc('read_google_refresh_token', { p_user: uid });
  if (token) await revokeToken(token as string);
  await db.rpc('delete_google_refresh_token', { p_user: uid });
  // Blocks stay in the app; they are no longer linked to Google events.
  await db
    .from('task_blocks')
    .update({ gcal_event_id: null, gcal_etag: null, gcal_calendar_id: null })
    .eq('user_id', uid)
    .not('gcal_event_id', 'is', null);
  await db.from('task_blocks').update({ status: 'accepted' }).eq('user_id', uid).eq('status', 'synced');
  log(FN, { event: 'disconnected' });
  return json({ ok: true });
});
