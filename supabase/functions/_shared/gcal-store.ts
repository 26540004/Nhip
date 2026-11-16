/** Deno-only: Supabase-backed SyncStore + helpers shared by gcal-auth and gcal-sync. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { env, requireEnv } from './context.ts';
import type { BusyEvent, SyncBlock, SyncConnection, SyncStore } from './gcal-sync-core.ts';
import { GoogleCalendar, GoogleError, type OAuthConfig, refreshAccessToken } from './google.ts';

export function oauthConfig(): OAuthConfig {
  return {
    clientId: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: requireEnv('GOOGLE_OAUTH_REDIRECT_URI'),
  };
}

/** HMAC key for OAuth state; derived from the service key so no extra secret is needed. */
export function stateSecret(): string {
  return env('GCAL_STATE_SECRET') ?? `nhip-oauth-state:${requireEnv('SUPABASE_SERVICE_ROLE_KEY')}`;
}

export const ERR_VI = {
  revoked: 'Google đã thu hồi quyền truy cập. Hãy kết nối lại.',
  failed: 'Đồng bộ Google Calendar thất bại. Thử lại sau.',
  noTarget: 'Chưa có lịch "Nhịp" trên Google. Hãy kết nối lại.',
};

export interface ConnectionRow {
  user_id: string;
  google_email: string | null;
  target_calendar_id: string | null;
  read_calendar_ids: string[];
  sync_tokens_json: Record<string, string>;
  status: string;
}

/** Access token for a user, or a GoogleError (isAuthRevoked) when the refresh token is dead. */
export async function accessTokenFor(db: SupabaseClient, userId: string): Promise<string> {
  const { data: token, error } = await db.rpc('read_google_refresh_token', { p_user: userId });
  if (error) throw error;
  if (!token) throw new GoogleError('no refresh token', 401, 'invalid_grant');
  const res = await refreshAccessToken(oauthConfig(), token as string);
  return res.access_token;
}

export async function markRevoked(db: SupabaseClient, userId: string): Promise<void> {
  await db.from('google_connections').update({ status: 'revoked', last_error: ERR_VI.revoked }).eq('user_id', userId);
}

export function supabaseSyncStore(db: SupabaseClient, userId: string): SyncStore {
  return {
    async loadBlocks(): Promise<SyncBlock[]> {
      const { data, error } = await db
        .from('task_blocks')
        .select('id, task_id, start_at, end_at, status, gcal_event_id, gcal_etag, tasks!inner(title, space)')
        .eq('user_id', userId)
        .or('status.in.(accepted,synced,conflict),and(status.eq.rejected,gcal_event_id.not.is.null)');
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => {
        const t = r.tasks as { title: string; space: 'study' | 'work' };
        return {
          id: r.id as string,
          task_id: r.task_id as string,
          start_at: r.start_at as string,
          end_at: r.end_at as string,
          status: r.status as SyncBlock['status'],
          gcal_event_id: (r.gcal_event_id as string | null) ?? null,
          gcal_etag: (r.gcal_etag as string | null) ?? null,
          title: t.title,
          space: t.space,
        };
      });
    },
    async updateBlock(id, patch) {
      const { error } = await db.from('task_blocks').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    },
    async replaceBusy(calendarId: string, window, events: BusyEvent[]) {
      if (window.start && window.end) {
        const keep = events.map((e) => e.gcal_event_id);
        let del = db
          .from('busy_cache')
          .delete()
          .eq('user_id', userId)
          .eq('source_calendar_id', calendarId)
          .lt('start_at', window.end)
          .gt('end_at', window.start);
        if (keep.length) del = del.not('gcal_event_id', 'in', `(${keep.map((k) => `"${k.replace(/"/g, '')}"`).join(',')})`);
        const { error } = await del;
        if (error) throw error;
      }
      if (events.length) {
        const { error } = await db.from('busy_cache').upsert(
          events.map((e) => ({ ...e, user_id: userId, source_calendar_id: calendarId, updated_at: new Date().toISOString() })),
          { onConflict: 'user_id,source_calendar_id,gcal_event_id' },
        );
        if (error) throw error;
      }
    },
    async saveSyncTokens(tokens) {
      const { error } = await db.from('google_connections').update({ sync_tokens_json: tokens }).eq('user_id', userId);
      if (error) throw error;
    },
  };
}

export async function loadConnection(db: SupabaseClient, userId: string): Promise<(SyncConnection & { status: string }) | null> {
  const [{ data: c }, { data: p }] = await Promise.all([
    db
      .from('google_connections')
      .select('target_calendar_id, read_calendar_ids, sync_tokens_json, status, refresh_token_secret_id')
      .eq('user_id', userId)
      .maybeSingle(),
    db.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
  ]);
  if (!c || !c.refresh_token_secret_id) return null;
  return {
    target_calendar_id: c.target_calendar_id,
    read_calendar_ids: c.read_calendar_ids ?? [],
    sync_tokens_json: (c.sync_tokens_json ?? {}) as Record<string, string>,
    tz: p?.timezone ?? 'Asia/Ho_Chi_Minh',
    status: c.status,
  };
}

export { GoogleCalendar };
