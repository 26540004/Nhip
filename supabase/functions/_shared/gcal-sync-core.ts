/**
 * Google Calendar two-way sync for one user. Storage and Google access are injected, so the
 * whole algorithm is unit-tested with fakes (src/__tests__/gcalSync.test.ts).
 *
 * Order per run:
 *  1. Push app → Google
 *     - rejected blocks that still have an event       → delete the event (undo / "Bỏ")
 *     - accepted blocks without an event               → insert (deterministic id ⇒ idempotent)
 *     - accepted blocks with an event (moved in app)   → patch with If-Match etag;
 *                                                         412 (edited in Google meanwhile) ⇒ Google's
 *                                                         times win, block marked 'conflict'
 *  2. Pull Google → app on the "Nhịp" target calendar with a syncToken (incremental):
 *     - event moved   → block times updated
 *     - event deleted → block 'rejected' (task goes back to "Chưa xếp lịch")
 *     - 410 Gone      → full resync; app events missing from Google are treated as deleted
 *  3. Refresh busy times of the READ calendars for [now − 1 day, now + 35 days].
 *     Read calendars use a bounded window (recurring events must be expanded with
 *     singleEvents=true, which Google does not allow together with time-bounded sync tokens).
 *     All-day and "free" (transparent) events are shown but do not block time.
 */
import { blockToEvent, eventIdForBlock, eventTimes, type GEvent, GoogleError, type GoogleCalendar } from './google.ts';

export interface SyncBlock {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: 'proposed' | 'accepted' | 'synced' | 'rejected' | 'conflict';
  gcal_event_id: string | null;
  gcal_etag: string | null;
  title: string;
  space: 'study' | 'work';
}

export interface SyncConnection {
  target_calendar_id: string | null;
  read_calendar_ids: string[];
  sync_tokens_json: Record<string, string>;
  tz: string;
}

export interface BusyEvent {
  gcal_event_id: string;
  start_at: string;
  end_at: string;
  title: string | null;
  all_day: boolean;
}

export interface SyncStore {
  /** Blocks of this user with status accepted/synced/conflict, or rejected with an event id. */
  loadBlocks(): Promise<SyncBlock[]>;
  updateBlock(
    id: string,
    patch: Partial<Omit<SyncBlock, 'id' | 'task_id' | 'title' | 'space'>> & { last_synced_at?: string; gcal_calendar_id?: string | null },
  ): Promise<void>;
  replaceBusy(calendarId: string, window: { start: string; end: string }, events: BusyEvent[]): Promise<void>;
  saveSyncTokens(tokens: Record<string, string>): Promise<void>;
}

export interface SyncResult {
  inserted: number;
  patched: number;
  deleted: number;
  conflicts: number;
  pulledMoved: number;
  pulledDeleted: number;
  busyEvents: number;
  fullResync: boolean;
}

const DAY = 86_400_000;

export async function syncUser(
  conn: SyncConnection,
  gcal: GoogleCalendar,
  store: SyncStore,
  opts: { now?: number; webAppUrl?: string | null } = {},
): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const result: SyncResult = {
    inserted: 0,
    patched: 0,
    deleted: 0,
    conflicts: 0,
    pulledMoved: 0,
    pulledDeleted: 0,
    busyEvents: 0,
    fullResync: false,
  };
  const target = conn.target_calendar_id;
  const tokens = { ...conn.sync_tokens_json };

  if (target) {
    // ---- 1. push ----------------------------------------------------------
    const blocks = await store.loadBlocks();
    for (const b of blocks) {
      if (b.status === 'rejected' && b.gcal_event_id) {
        await gcal.deleteEvent(target, b.gcal_event_id);
        await store.updateBlock(b.id, { gcal_event_id: null, gcal_etag: null, last_synced_at: nowIso });
        result.deleted++;
      } else if (b.status === 'accepted' && !b.gcal_event_id) {
        const ev = blockToEvent(b, conn.tz, opts.webAppUrl);
        let created: GEvent;
        try {
          created = await gcal.insertEvent(target, ev);
        } catch (e) {
          if (!(e instanceof GoogleError && e.status === 409)) throw e;
          // Already inserted by an earlier interrupted run: bring it to the current times.
          created = await gcal.patchEvent(target, ev.id, { start: ev.start, end: ev.end, summary: ev.summary });
        }
        await store.updateBlock(b.id, {
          status: 'synced',
          gcal_event_id: created.id,
          gcal_calendar_id: target,
          gcal_etag: created.etag ?? null,
          last_synced_at: nowIso,
        });
        result.inserted++;
      } else if (b.status === 'accepted' && b.gcal_event_id) {
        const ev = blockToEvent(b, conn.tz, opts.webAppUrl);
        try {
          const updated = await gcal.patchEvent(
            target,
            b.gcal_event_id,
            { start: ev.start, end: ev.end, summary: ev.summary },
            b.gcal_etag,
          );
          await store.updateBlock(b.id, { status: 'synced', gcal_etag: updated.etag ?? null, last_synced_at: nowIso });
          result.patched++;
        } catch (e) {
          if (e instanceof GoogleError && e.status === 412) {
            const current = await gcal.getEvent(target, b.gcal_event_id);
            const t = eventTimes(current);
            await store.updateBlock(b.id, {
              status: current.status === 'cancelled' ? 'rejected' : 'conflict',
              ...(t ? { start_at: new Date(t.start).toISOString(), end_at: new Date(t.end).toISOString() } : {}),
              gcal_etag: current.etag ?? null,
              ...(current.status === 'cancelled' ? { gcal_event_id: null } : {}),
              last_synced_at: nowIso,
            });
            result.conflicts++;
          } else if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) {
            // Deleted in Google while we were moving it → respect the deletion.
            await store.updateBlock(b.id, { status: 'rejected', gcal_event_id: null, gcal_etag: null, last_synced_at: nowIso });
            result.pulledDeleted++;
          } else {
            throw e;
          }
        }
      }
    }

    // ---- 2. pull target calendar --------------------------------------------
    const fresh = await store.loadBlocks();
    const byEvent = new Map(fresh.filter((b) => b.gcal_event_id).map((b) => [b.gcal_event_id!, b]));
    const token = tokens[target];
    let list: { items: GEvent[]; nextSyncToken?: string };
    let full = !token;
    try {
      list = await gcal.listAllEvents(
        target,
        token ? { syncToken: token, showDeleted: 'true' } : { showDeleted: 'true', maxResults: '2500' },
      );
    } catch (e) {
      if (!(e instanceof GoogleError && e.status === 410)) throw e;
      full = true;
      list = await gcal.listAllEvents(target, { showDeleted: 'true', maxResults: '2500' });
    }
    result.fullResync = full;

    const seen = new Set<string>();
    const manual: BusyEvent[] = [];
    for (const ev of list.items) {
      seen.add(ev.id);
      const block = byEvent.get(ev.id) ?? fresh.find((b) => eventIdForBlock(b.id) === ev.id);
      if (!block) {
        // Event the user created by hand in the "Nhịp" calendar → counts as busy time.
        const t = eventTimes(ev);
        if (ev.status !== 'cancelled' && t) {
          manual.push({
            gcal_event_id: ev.id,
            start_at: new Date(t.start).toISOString(),
            end_at: new Date(t.end).toISOString(),
            title: ev.summary ?? null,
            all_day: t.allDay,
          });
        }
        continue;
      }
      if (ev.status === 'cancelled') {
        if (block.status !== 'rejected') {
          await store.updateBlock(block.id, { status: 'rejected', gcal_event_id: null, gcal_etag: null, last_synced_at: nowIso });
          result.pulledDeleted++;
        }
        continue;
      }
      if (block.status === 'accepted') continue; // local change pending; pushed next run
      const t = eventTimes(ev);
      if (t && !t.allDay && (t.start !== Date.parse(block.start_at) || t.end !== Date.parse(block.end_at))) {
        await store.updateBlock(block.id, {
          start_at: new Date(t.start).toISOString(),
          end_at: new Date(t.end).toISOString(),
          status: 'synced',
          gcal_etag: ev.etag ?? null,
          last_synced_at: nowIso,
        });
        result.pulledMoved++;
      } else if (ev.etag && ev.etag !== block.gcal_etag) {
        await store.updateBlock(block.id, { gcal_etag: ev.etag, last_synced_at: nowIso });
      }
    }
    if (full) {
      // Anything we think is in Google but isn't → deleted there.
      for (const b of fresh) {
        if (b.gcal_event_id && (b.status === 'synced' || b.status === 'conflict') && !seen.has(b.gcal_event_id)) {
          await store.updateBlock(b.id, { status: 'rejected', gcal_event_id: null, gcal_etag: null, last_synced_at: nowIso });
          result.pulledDeleted++;
        }
      }
      await store.replaceBusy(target, { start: new Date(0).toISOString(), end: new Date(now + 3650 * DAY).toISOString() }, manual);
    } else if (manual.length) {
      await store.replaceBusy(target, { start: '', end: '' }, manual); // upsert only (empty window ⇒ no deletes)
    }
    if (list.nextSyncToken) tokens[target] = list.nextSyncToken;
  }

  // ---- 3. busy times from read calendars ------------------------------------
  const window = { start: new Date(now - DAY).toISOString(), end: new Date(now + 35 * DAY).toISOString() };
  for (const cal of conn.read_calendar_ids) {
    if (cal === target) continue;
    let items: GEvent[];
    try {
      items = (
        await gcal.listAllEvents(cal, {
          timeMin: window.start,
          timeMax: window.end,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '2500',
        })
      ).items;
    } catch (e) {
      // A calendar that was unshared/deleted shouldn't break the whole sync.
      if (e instanceof GoogleError && (e.status === 404 || e.status === 403)) continue;
      throw e;
    }
    const busy: BusyEvent[] = [];
    for (const ev of items) {
      if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
      const t = eventTimes(ev);
      if (!t) continue;
      busy.push({
        gcal_event_id: ev.id,
        start_at: new Date(t.start).toISOString(),
        end_at: new Date(t.end).toISOString(),
        title: ev.summary ?? null,
        all_day: t.allDay,
      });
    }
    await store.replaceBusy(cal, window, busy);
    result.busyEvents += busy.length;
  }

  await store.saveSyncTokens(tokens);
  return result;
}
