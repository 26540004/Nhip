/**
 * Google Calendar sync algorithm against an in-memory fake Google + store.
 * Covers spec §N: approved blocks appear in the target calendar; moving an event in Google
 * updates the block; deleting it returns the task to "Chưa xếp lịch"; undo deletes events.
 */
import { type BusyEvent, type SyncBlock, type SyncStore, syncUser } from '../../supabase/functions/_shared/gcal-sync-core.ts';
import {
  blockToEvent,
  eventIdForBlock,
  type GEvent,
  GoogleError,
  isAllowedReturnUrl,
  signState,
  verifyState,
} from '../../supabase/functions/_shared/google.ts';

const NOW = Date.parse('2026-11-16T07:00:00Z');
const TARGET = 'nhip-cal';

class FakeGoogle {
  events = new Map<string, Map<string, GEvent>>(); // calendar → id → event
  syncTokenValid = true;
  etagCounter = 1;
  calls: string[] = [];

  cal(id: string) {
    if (!this.events.has(id)) this.events.set(id, new Map());
    return this.events.get(id)!;
  }
  async insertEvent(calendarId: string, ev: GEvent) {
    this.calls.push(`insert ${ev.id}`);
    const c = this.cal(calendarId);
    if (c.has(ev.id) && c.get(ev.id)!.status !== 'cancelled') throw new GoogleError('dup', 409);
    const stored = { ...ev, status: 'confirmed' as const, etag: `"e${this.etagCounter++}"` };
    c.set(ev.id, stored);
    return stored;
  }
  async patchEvent(calendarId: string, id: string, patch: Partial<GEvent>, etag?: string | null) {
    this.calls.push(`patch ${id}`);
    const c = this.cal(calendarId);
    const cur = c.get(id);
    if (!cur || cur.status === 'cancelled') throw new GoogleError('gone', 404);
    if (etag && cur.etag !== etag) throw new GoogleError('precondition', 412);
    const next = { ...cur, ...patch, etag: `"e${this.etagCounter++}"` };
    c.set(id, next);
    return next;
  }
  async getEvent(calendarId: string, id: string) {
    const ev = this.cal(calendarId).get(id);
    if (!ev) throw new GoogleError('nf', 404);
    return ev;
  }
  async deleteEvent(calendarId: string, id: string) {
    this.calls.push(`delete ${id}`);
    const ev = this.cal(calendarId).get(id);
    if (ev) ev.status = 'cancelled';
  }
  async listAllEvents(calendarId: string, params: Record<string, string>) {
    if (params.syncToken && !this.syncTokenValid) throw new GoogleError('gone', 410);
    const items = [...this.cal(calendarId).values()].filter((e) => params.showDeleted === 'true' || e.status !== 'cancelled');
    return { items, nextSyncToken: `tok-${this.etagCounter}` };
  }
  /** Simulate the user dragging the event in Google Calendar. */
  moveInGoogle(id: string, start: string, end: string) {
    const ev = this.cal(TARGET).get(id)!;
    this.cal(TARGET).set(id, { ...ev, start: { dateTime: start }, end: { dateTime: end }, etag: `"e${this.etagCounter++}"` });
  }
}

class FakeStore implements SyncStore {
  blocks = new Map<string, SyncBlock>();
  busy = new Map<string, BusyEvent[]>();
  tokens: Record<string, string> = {};
  async loadBlocks() {
    return [...this.blocks.values()].map((b) => ({ ...b }));
  }
  async updateBlock(id: string, patch: Partial<SyncBlock>) {
    this.blocks.set(id, { ...this.blocks.get(id)!, ...patch });
  }
  async replaceBusy(cal: string, _w: { start: string; end: string }, events: BusyEvent[]) {
    this.busy.set(cal, events);
  }
  async saveSyncTokens(t: Record<string, string>) {
    this.tokens = t;
  }
}

function block(id: string, status: SyncBlock['status'], start = '2026-11-16T12:00:00.000Z', end = '2026-11-16T13:00:00.000Z'): SyncBlock {
  return {
    id,
    task_id: `task-${id}`,
    start_at: start,
    end_at: end,
    status,
    gcal_event_id: null,
    gcal_etag: null,
    title: `Việc ${id}`,
    space: 'study',
  };
}

const conn = (store: FakeStore) => ({
  target_calendar_id: TARGET,
  read_calendar_ids: ['primary'],
  sync_tokens_json: store.tokens,
  tz: 'Asia/Ho_Chi_Minh',
});

async function run(g: FakeGoogle, s: FakeStore) {
  return syncUser(conn(s), g as never, s, { now: NOW });
}

const B1 = '0b3c2d1e-aaaa-4bbb-8ccc-111111111111';
const B2 = '0b3c2d1e-aaaa-4bbb-8ccc-222222222222';

describe('gcal sync', () => {
  it('accepted blocks are inserted into the target calendar with app metadata', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    const r = await run(g, s);
    expect(r.inserted).toBe(1);
    const ev = g.cal(TARGET).get(eventIdForBlock(B1))!;
    expect(ev.extendedProperties?.private).toEqual({ appTaskId: `task-${B1}`, appBlockId: B1 });
    expect(ev.colorId).toBe('9');
    expect(s.blocks.get(B1)).toMatchObject({ status: 'synced', gcal_event_id: eventIdForBlock(B1) });
  });

  it('re-running is idempotent (409 → patch, no duplicate)', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    await run(g, s);
    // Simulate a crash before the DB update: block still "accepted" without event id.
    s.blocks.set(B1, block(B1, 'accepted'));
    await run(g, s);
    expect(g.cal(TARGET).size).toBe(1);
    expect(s.blocks.get(B1)!.status).toBe('synced');
  });

  it('moving an event in Google updates the block after sync', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    await run(g, s);
    g.moveInGoogle(eventIdForBlock(B1), '2026-11-16T14:00:00Z', '2026-11-16T15:30:00Z');
    const r = await run(g, s);
    expect(r.pulledMoved).toBe(1);
    expect(s.blocks.get(B1)).toMatchObject({ start_at: '2026-11-16T14:00:00.000Z', end_at: '2026-11-16T15:30:00.000Z', status: 'synced' });
  });

  it('deleting an event in Google rejects the block (task back to "Chưa xếp lịch")', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    await run(g, s);
    g.cal(TARGET).get(eventIdForBlock(B1))!.status = 'cancelled';
    const r = await run(g, s);
    expect(r.pulledDeleted).toBe(1);
    expect(s.blocks.get(B1)).toMatchObject({ status: 'rejected', gcal_event_id: null });
  });

  it('undo (block rejected in app) deletes the Google event', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    s.blocks.set(B2, block(B2, 'accepted', '2026-11-16T13:10:00.000Z', '2026-11-16T14:00:00.000Z'));
    await run(g, s);
    for (const id of [B1, B2]) s.blocks.set(id, { ...s.blocks.get(id)!, status: 'rejected' });
    const r = await run(g, s);
    expect(r.deleted).toBe(2);
    expect([...g.cal(TARGET).values()].every((e) => e.status === 'cancelled')).toBe(true);
    expect([...s.blocks.values()].every((b) => b.gcal_event_id === null)).toBe(true);
  });

  it('a block moved in the app is patched; concurrent Google edit → conflict, Google times kept', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    await run(g, s);
    // App move:
    s.blocks.set(B1, {
      ...s.blocks.get(B1)!,
      status: 'accepted',
      start_at: '2026-11-16T09:00:00.000Z',
      end_at: '2026-11-16T10:00:00.000Z',
    });
    const r1 = await run(g, s);
    expect(r1.patched).toBe(1);
    expect(g.cal(TARGET).get(eventIdForBlock(B1))!.start?.dateTime).toBe('2026-11-16T09:00:00.000Z');

    // Both sides edit: Google changes etag, then the app moves again with the stale etag.
    g.moveInGoogle(eventIdForBlock(B1), '2026-11-16T15:00:00Z', '2026-11-16T16:00:00Z');
    s.blocks.set(B1, {
      ...s.blocks.get(B1)!,
      status: 'accepted',
      start_at: '2026-11-16T10:00:00.000Z',
      end_at: '2026-11-16T11:00:00.000Z',
    });
    const r2 = await run(g, s);
    expect(r2.conflicts).toBe(1);
    expect(s.blocks.get(B1)).toMatchObject({ status: 'conflict', start_at: '2026-11-16T15:00:00.000Z' });
  });

  it('410 Gone → full resync; events missing from Google are treated as deleted', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    s.blocks.set(B1, block(B1, 'accepted'));
    await run(g, s);
    g.cal(TARGET).delete(eventIdForBlock(B1)); // vanished entirely
    g.syncTokenValid = false;
    const r = await run(g, s);
    expect(r.fullResync).toBe(true);
    expect(s.blocks.get(B1)!.status).toBe('rejected');
  });

  it('busy times: skips cancelled and "free" events, keeps all-day flagged, reads only read calendars', async () => {
    const g = new FakeGoogle();
    const s = new FakeStore();
    g.cal('primary').set('a', {
      id: 'a',
      status: 'confirmed',
      summary: 'Họp',
      start: { dateTime: '2026-11-16T02:00:00Z' },
      end: { dateTime: '2026-11-16T03:00:00Z' },
    });
    g.cal('primary').set('b', {
      id: 'b',
      status: 'cancelled',
      start: { dateTime: '2026-11-16T04:00:00Z' },
      end: { dateTime: '2026-11-16T05:00:00Z' },
    });
    g.cal('primary').set('c', {
      id: 'c',
      status: 'confirmed',
      transparency: 'transparent',
      start: { dateTime: '2026-11-16T06:00:00Z' },
      end: { dateTime: '2026-11-16T07:00:00Z' },
    });
    g.cal('primary').set('d', {
      id: 'd',
      status: 'confirmed',
      summary: 'Sinh nhật',
      start: { date: '2026-11-17' },
      end: { date: '2026-11-18' },
    });
    const r = await run(g, s);
    expect(r.busyEvents).toBe(2);
    expect(s.busy.get('primary')!.map((e) => [e.gcal_event_id, e.all_day])).toEqual([
      ['a', false],
      ['d', true],
    ]);
  });

  it('event payload and helpers', async () => {
    const ev = blockToEvent(
      { id: B1, task_id: 't1', start_at: '2026-11-16T12:00:00Z', end_at: '2026-11-16T13:00:00Z', title: 'Báo cáo', space: 'work' },
      'Asia/Ho_Chi_Minh',
      'https://nhip.app',
    );
    expect(ev.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(ev.colorId).toBe('6');
    expect(ev.description).toContain('nhip://task/t1');
    expect(ev.description).toContain('https://nhip.app/task/t1');
  });
});

describe('OAuth state & redirects', () => {
  it('signed state round-trips, rejects tampering and expiry', async () => {
    const st = { uid: 'u1', ret: 'nhip://settings/google', exp: Date.now() + 60_000, n: 'x' };
    const token = await signState(st, 'secret');
    expect(await verifyState(token, 'secret')).toEqual(st);
    expect(await verifyState(token, 'other')).toBeNull();
    expect(
      await verifyState(
        token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
        'secret',
      ),
    ).toBeNull();
    expect(await verifyState(await signState({ ...st, exp: Date.now() - 1 }, 'secret'), 'secret')).toBeNull();
  });

  it('only allows app, configured web or localhost return URLs', () => {
    expect(isAllowedReturnUrl('nhip://settings/google')).toBe(true);
    expect(isAllowedReturnUrl('http://localhost:8081/settings/google')).toBe(true);
    expect(isAllowedReturnUrl('https://nhip.app/settings/google', 'https://nhip.app')).toBe(true);
    expect(isAllowedReturnUrl('https://evil.example/steal', 'https://nhip.app')).toBe(false);
  });
});
