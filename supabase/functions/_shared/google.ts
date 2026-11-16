/**
 * Google OAuth + Calendar REST helpers (no SDK, fetch only; runs in Deno and Jest).
 *
 * Scopes (narrowest that cover the spec; verified against Google's Calendar API scope list):
 *  - openid, email                         → show which Google account is connected
 *  - calendar.calendarlist.readonly        → list calendars so the user can pick which to READ
 *  - calendar.events.readonly              → read events (times + titles) of the selected calendars
 *  - calendar.app.created                  → create the dedicated "Nhịp" calendar and create /
 *                                             update / delete events ONLY in calendars this app created
 * The app therefore cannot modify any of the user's other calendars.
 */

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];

const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'GoogleError';
  }
  /** Refresh token revoked / expired → user must reconnect. */
  get isAuthRevoked(): boolean {
    return this.reason === 'invalid_grant' || this.status === 401;
  }
}

type FetchFn = typeof fetch;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(cfg: OAuthConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', // refresh token
    prompt: 'consent', // always return a refresh token, even on re-connect
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>, fetchFn: FetchFn): Promise<TokenResponse> {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (!res.ok) throw new GoogleError(`token ${res.status}`, res.status, data.error ?? null);
  return data;
}

export function exchangeCode(cfg: OAuthConfig, code: string, fetchFn: FetchFn = fetch): Promise<TokenResponse> {
  return tokenRequest(
    { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' },
    fetchFn,
  );
}

export function refreshAccessToken(cfg: OAuthConfig, refreshToken: string, fetchFn: FetchFn = fetch): Promise<TokenResponse> {
  return tokenRequest(
    { refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' },
    fetchFn,
  );
}

export async function revokeToken(token: string, fetchFn: FetchFn = fetch): Promise<void> {
  await fetchFn(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

/** Email from an id_token received directly from Google's token endpoint over TLS. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(payload + '='.repeat((4 - (payload.length % 4)) % 4))) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

export interface GEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag?: string;
  summary?: string;
  description?: string;
  transparency?: 'opaque' | 'transparent';
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
}

export interface GCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
  backgroundColor?: string;
  selected?: boolean;
}

export interface EventsPage {
  items: GEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export class GoogleCalendar {
  constructor(
    private readonly accessToken: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json', ...headers },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[]; message?: string } };
    if (!res.ok) {
      throw new GoogleError(data.error?.message ?? `google ${res.status}`, res.status, data.error?.errors?.[0]?.reason ?? null);
    }
    return data as T;
  }

  async listCalendars(): Promise<GCalendarListEntry[]> {
    const out: GCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const page = await this.call<{ items?: GCalendarListEntry[]; nextPageToken?: string }>('GET', `/users/me/calendarList?${q}`);
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  createCalendar(summary: string, timeZone: string): Promise<{ id: string }> {
    return this.call('POST', '/calendars', { summary, timeZone, description: 'Các khối việc do Nhịp xếp lịch.' });
  }

  async calendarExists(id: string): Promise<boolean> {
    try {
      await this.call('GET', `/calendars/${encodeURIComponent(id)}`);
      return true;
    } catch (e) {
      if (e instanceof GoogleError && (e.status === 404 || e.status === 403)) return false;
      throw e;
    }
  }

  listEvents(calendarId: string, params: Record<string, string>): Promise<EventsPage> {
    const q = new URLSearchParams(params);
    return this.call('GET', `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  }

  /** All pages. Throws GoogleError 410 when a sync token expired (caller does a full resync). */
  async listAllEvents(calendarId: string, params: Record<string, string>): Promise<{ items: GEvent[]; nextSyncToken?: string }> {
    const items: GEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await this.listEvents(calendarId, { ...params, ...(pageToken ? { pageToken } : {}) });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
      if (!pageToken) break;
    }
    return { items, nextSyncToken };
  }

  getEvent(calendarId: string, eventId: string): Promise<GEvent> {
    return this.call('GET', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }

  insertEvent(calendarId: string, event: GEvent): Promise<GEvent> {
    return this.call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, event);
  }

  patchEvent(calendarId: string, eventId: string, patch: Partial<GEvent>, etag?: string | null): Promise<GEvent> {
    return this.call(
      'PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      patch,
      etag ? { 'If-Match': etag } : {},
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (e) {
      // Already gone is fine.
      if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping (pure)
// ---------------------------------------------------------------------------

/** Google event colorId per space (palette ids: 9 = Blueberry, 6 = Tangerine). */
export const COLOR_ID: Record<'study' | 'work', string> = { study: '9', work: '6' };

/** Deterministic Google event id for a block (base32hex alphabet: 0-9a-v) → idempotent inserts. */
export function eventIdForBlock(blockId: string): string {
  return `nhip${blockId.replace(/-/g, '').toLowerCase()}`;
}

export interface BlockForEvent {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  title: string;
  space: 'study' | 'work';
}

export function blockToEvent(b: BlockForEvent, tz: string, webAppUrl?: string | null): GEvent {
  const links = [`Mở trong Nhịp: nhip://task/${b.task_id}`];
  if (webAppUrl) links.push(`${webAppUrl.replace(/\/$/, '')}/task/${b.task_id}`);
  return {
    id: eventIdForBlock(b.id),
    summary: b.title,
    description: links.join('\n'),
    start: { dateTime: new Date(b.start_at).toISOString(), timeZone: tz },
    end: { dateTime: new Date(b.end_at).toISOString(), timeZone: tz },
    colorId: COLOR_ID[b.space],
    transparency: 'opaque',
    extendedProperties: { private: { appTaskId: b.task_id, appBlockId: b.id } },
    // Nhịp sends its own start-of-block reminder; avoid a duplicate from Google.
    ...({ reminders: { useDefault: false, overrides: [] } } as Record<string, unknown>),
  };
}

/** Event start/end as instants; null for all-day or malformed events. */
export function eventTimes(e: GEvent): { start: number; end: number; allDay: boolean } | null {
  if (e.start?.dateTime && e.end?.dateTime) {
    const start = Date.parse(e.start.dateTime);
    const end = Date.parse(e.end.dateTime);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end, allDay: false } : null;
  }
  if (e.start?.date && e.end?.date) {
    return { start: Date.parse(`${e.start.date}T00:00:00Z`), end: Date.parse(`${e.end.date}T00:00:00Z`), allDay: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Signed OAuth state (HMAC-SHA256)
// ---------------------------------------------------------------------------

export interface OAuthState {
  uid: string;
  ret: string;
  exp: number;
  n: string;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signState(state: OAuthState, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(state)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(token: string, secret: string, now: number = Date.now()): Promise<OAuthState | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if ((await hmac(secret, body)) !== sig) return null;
  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.length % 4)) % 4));
    const state = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as OAuthState;
    return state.exp > now ? state : null;
  } catch {
    return null;
  }
}

/** Only redirect back to the app scheme, the configured web app, or localhost (dev). */
export function isAllowedReturnUrl(url: string, webAppUrl?: string | null): boolean {
  if (url.startsWith('nhip://')) return true;
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (webAppUrl && u.origin === new URL(webAppUrl).origin) return true;
  } catch {
    return false;
  }
  return false;
}
