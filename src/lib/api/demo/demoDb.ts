/**
 * In-memory stand-in for Supabase used by the browser demo (EXPO_PUBLIC_DEMO=1).
 *
 * Implements exactly the subset of the supabase-js query builder the app uses
 * (select/insert/update/upsert/delete, eq/neq/in/lt/gt/gte/lte/is/not/or, order, limit,
 * single/maybeSingle, the ai_proposals!inner embed) over plain arrays. Data is persisted
 * to localStorage when available so the demo survives a reload; it never leaves the browser.
 */
import * as Crypto from 'expo-crypto';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const DEMO_UID = '00000000-0000-4000-8000-00000000d3e0';
const STORAGE_KEY = 'nhip-demo-db-v2';

const WITH_UPDATED_AT = new Set([
  'tasks',
  'notes',
  'collections',
  'task_blocks',
  'attachments',
  'audio_segments',
  'profiles',
  'reminder_settings',
  'google_connections',
]);

export class DemoDb {
  tables: Tables;
  private listeners = new Set<() => void>();

  constructor(private readonly seed: () => Tables) {
    this.tables = this.load() ?? seed();
  }

  private load(): Tables | null {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Tables) : null;
    } catch {
      return null;
    }
  }

  save(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.tables));
    } catch {
      /* storage unavailable (sandboxed frame): keep data in memory only */
    }
    for (const l of this.listeners) l();
  }

  reset(): void {
    this.tables = this.seed();
    this.save();
  }

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name]!;
  }

  newRow(table: string, row: Row): Row {
    const now = new Date().toISOString();
    const base: Row = { user_id: DEMO_UID, created_at: now };
    if (WITH_UPDATED_AT.has(table)) base.updated_at = now;
    if (!('id' in row) && table !== 'profiles') base.id = Crypto.randomUUID();
    return { ...base, ...TABLE_DEFAULTS[table], ...row };
  }

  /** Cascades the database would do with foreign keys / triggers. */
  cascadeDelete(table: string, ids: Set<unknown>): void {
    if (table === 'tasks') {
      const children = this.table('tasks')
        .filter((t) => ids.has(t.parent_task_id))
        .map((t) => t.id);
      if (children.length) {
        children.forEach((c) => ids.add(c));
        this.tables.tasks = this.table('tasks').filter((t) => !ids.has(t.id));
      }
      this.tables.task_blocks = this.table('task_blocks').filter((b) => !ids.has(b.task_id));
      this.dropAttachments((a) => a.owner_type === 'task' && ids.has(a.owner_id));
    }
    if (table === 'notes') this.dropAttachments((a) => a.owner_type === 'note' && ids.has(a.owner_id));
    if (table === 'attachments') this.tables.audio_segments = this.table('audio_segments').filter((s) => !ids.has(s.attachment_id));
  }

  private dropAttachments(match: (a: Row) => boolean): void {
    const gone = new Set(
      this.table('attachments')
        .filter(match)
        .map((a) => a.id),
    );
    this.tables.attachments = this.table('attachments').filter((a) => !gone.has(a.id));
    this.tables.audio_segments = this.table('audio_segments').filter((s) => !gone.has(s.attachment_id));
  }
}

const TABLE_DEFAULTS: Record<string, Row> = {
  tasks: {
    collection_id: null,
    parent_task_id: null,
    description: null,
    deadline_at: null,
    estimate_minutes: null,
    priority: 2,
    priority_reason: null,
    status: 'todo',
    source: 'form',
    source_note_id: null,
    needs_parse: false,
    sort_order: 0,
    completed_at: null,
    actual_minutes: null,
  },
  notes: { collection_id: null, title: '', content_json: {}, plain_text: '', pinned: false },
  collections: { color_variant: 0, archived: false },
  task_blocks: {
    status: 'proposed',
    proposal_id: null,
    reason: null,
    gcal_event_id: null,
    gcal_calendar_id: null,
    gcal_etag: null,
    last_synced_at: null,
  },
  attachments: {
    storage_path: null,
    url: null,
    title: null,
    meta_json: {},
    duration_sec: null,
    bookmarks_json: [],
    transcript_status: 'none',
    transcript_text: null,
    summary_json: null,
  },
  ai_proposals: { status: 'pending', response_json: null, validation_report_json: null, provider: null, model: null },
  audio_segments: { mime: 'audio/mp4', uploaded: false, transcript_status: 'none', transcript_json: null, attempts: 0, last_error: null },
};

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Pred = (r: Row) => boolean;
type Result = { data: unknown; error: { message: string; code?: string } | null };

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (/^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b) && !Number.isNaN(da) && !Number.isNaN(db)) return da - db;
    return a.localeCompare(b);
  }
  return Number(a) - Number(b);
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(b))
    return Date.parse(a) === Date.parse(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return a === b || (a != null && b != null && String(a) === String(b));
}

function parseList(v: string): string[] {
  return v
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^"|"$/g, ''));
}

/** "status.in.(todo,doing),updated_at.gte.2026-…" → predicates (top-level commas only). */
function parseOr(expr: string): Pred {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  const preds = parts.map((p): Pred => {
    const and = /^and\((.*)\)$/.exec(p);
    if (and) {
      const inner = and[1]!.split(/,(?![^(]*\))/).map((x) => parseOr(x));
      return (r) => inner.every((f) => f(r));
    }
    const [col, op, ...rest] = p.split('.');
    const val = rest.join('.');
    return opPred(col!, op!, val);
  });
  return (r) => preds.some((f) => f(r));
}

function opPred(col: string, op: string, val: string): Pred {
  switch (op) {
    case 'eq':
      return (r) => same(r[col], val);
    case 'neq':
      return (r) => !same(r[col], val);
    case 'in':
      return (r) => parseList(val).some((v) => same(r[col], v));
    case 'gte':
      return (r) => r[col] != null && cmp(r[col], val) >= 0;
    case 'gt':
      return (r) => r[col] != null && cmp(r[col], val) > 0;
    case 'lte':
      return (r) => r[col] != null && cmp(r[col], val) <= 0;
    case 'lt':
      return (r) => r[col] != null && cmp(r[col], val) < 0;
    case 'is':
      return (r) => (val === 'null' ? r[col] == null : same(r[col], val));
    case 'not':
      return opPred(col, val.split('.')[0]!, val.split('.').slice(1).join('.'));
    default:
      return () => true;
  }
}

export class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private ignoreDup = false;
  private returning = false;
  private conflict: string[] | null = null;
  private filters: Pred[] = [];
  private orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  private limitN: number | null = null;
  private single: 'single' | 'maybe' | null = null;
  private payload: Row | Row[] | null = null;
  private embed: string | null = null;

  constructor(
    private readonly db: DemoDb,
    private readonly name: string,
  ) {}

  select(cols = '*'): this {
    if (this.op === 'select') this.parseEmbed(cols);
    else this.returning = true;
    return this;
  }
  private parseEmbed(cols: string) {
    const m = /(\w+)!inner\(/.exec(cols);
    this.embed = m ? m[1]! : null;
  }
  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = 'upsert';
    this.payload = rows;
    this.ignoreDup = opts?.ignoreDuplicates ?? false;
    this.conflict = opts?.onConflict
      ? opts.onConflict
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c !== 'user_id')
      : null;
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }

  private colPred(col: string, p: (v: unknown) => boolean): Pred {
    if (col.includes('.')) {
      const [rel, c] = col.split('.') as [string, string];
      return (r) => {
        const e = r[rel] as Row | undefined;
        return e != null && p(e[c]);
      };
    }
    return (r) => p(r[col]);
  }
  eq(col: string, v: unknown): this {
    this.filters.push(this.colPred(col, (x) => same(x, v)));
    return this;
  }
  neq(col: string, v: unknown): this {
    this.filters.push(this.colPred(col, (x) => !same(x, v)));
    return this;
  }
  in(col: string, vs: readonly unknown[]): this {
    this.filters.push(this.colPred(col, (x) => vs.some((v) => same(x, v))));
    return this;
  }
  lt(col: string, v: unknown): this {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) < 0);
    return this;
  }
  lte(col: string, v: unknown): this {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) <= 0);
    return this;
  }
  gt(col: string, v: unknown): this {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) > 0);
    return this;
  }
  gte(col: string, v: unknown): this {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) >= 0);
    return this;
  }
  is(col: string, v: null | boolean): this {
    this.filters.push((r) => (v === null ? r[col] == null : r[col] === v));
    return this;
  }
  not(col: string, op: string, v: unknown): this {
    const p = op === 'is' ? opPred(col, 'is', String(v)) : opPred(col, op, String(v));
    this.filters.push((r) => !p(r));
    return this;
  }
  or(expr: string): this {
    this.filters.push(parseOr(expr));
    return this;
  }
  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orders.push({ col, asc: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? !(opts.ascending ?? true) });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): this {
    this.single = 'maybe';
    return this;
  }
  single_(): this {
    this.single = 'single';
    return this;
  }

  private rows(): Row[] {
    let rows = this.db.table(this.name);
    if (this.embed) {
      const rel = this.embed;
      const fk = rel === 'ai_proposals' ? 'proposal_id' : rel === 'tasks' ? 'task_id' : `${rel}_id`;
      const other = new Map(this.db.table(rel).map((r) => [r.id, r]));
      rows = rows.map((r) => ({ ...r, [rel]: other.get(r[fk]) })).filter((r) => r[rel] != null);
    }
    return rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private finish(data: Row[]): Result {
    let out = data;
    for (const o of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[o.col];
        const bv = b[o.col];
        if (av == null && bv == null) return 0;
        if (av == null) return o.nullsFirst ? -1 : 1;
        if (bv == null) return o.nullsFirst ? 1 : -1;
        const c = typeof av === 'boolean' ? Number(av) - Number(bv) : cmp(av, bv);
        return o.asc ? c : -c;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    const copy = out.map((r) => JSON.parse(JSON.stringify(r)) as Row);
    if (this.single === 'maybe') return { data: copy[0] ?? null, error: null };
    if (this.single === 'single')
      return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: 'not single', code: 'PGRST116' } };
    return { data: copy, error: null };
  }

  private exec(): Result {
    const t = this.name;
    if (this.op === 'select') return this.finish(this.rows());
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]) as Row[];
      const done: Row[] = [];
      for (const raw of list) {
        // Generated column (see migration 006).
        const r =
          t === 'vocab_entries'
            ? {
                ...raw,
                short_key: String(raw.short ?? '')
                  .trim()
                  .toLowerCase(),
              }
            : raw;
        const conflict = this.conflict;
        const existing =
          this.op !== 'upsert'
            ? undefined
            : conflict
              ? this.db.table(t).find((x) => conflict.every((c) => x[c] === r[c]))
              : r.id != null
                ? this.db.table(t).find((x) => x.id === r.id)
                : undefined;
        if (existing && this.ignoreDup) continue;
        if (existing) {
          Object.assign(existing, r, WITH_UPDATED_AT.has(t) ? { updated_at: new Date().toISOString() } : {});
          done.push(existing);
        } else {
          const row = this.db.newRow(t, r);
          this.db.table(t).push(row);
          done.push(row);
        }
      }
      this.db.save();
      return this.returning ? this.finish(done) : { data: null, error: null };
    }
    if (this.op === 'update') {
      const hits = this.rows();
      const ids = new Set(hits.map((h) => h.id));
      // rows() returns live references unless an embed was joined in.
      const targets = this.embed ? this.db.table(t).filter((x) => ids.has(x.id)) : hits;
      for (const x of targets) Object.assign(x, this.payload, WITH_UPDATED_AT.has(t) ? { updated_at: new Date().toISOString() } : {});
      this.db.save();
      return this.returning ? this.finish(targets) : { data: null, error: null };
    }
    // delete
    const victims = this.rows();
    const ids = new Set(victims.map((v) => v.id));
    this.db.tables[t] = this.db.table(t).filter((x) => !ids.has(x.id));
    this.db.cascadeDelete(t, ids);
    this.db.save();
    return this.returning ? this.finish(victims) : { data: null, error: null };
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let res: Result;
    try {
      res = this.exec();
    } catch (e) {
      res = { data: null, error: { message: e instanceof Error ? e.message : 'demo error' } };
    }
    return Promise.resolve(res).then(ok, fail);
  }
}

/** supabase-js calls `.single()` – exposed via a proxy so the builder keeps one method name. */
export function query(db: DemoDb, table: string): Query {
  const q = new Query(db, table);
  return new Proxy(q, {
    get(target, prop, recv) {
      if (prop === 'single') return () => (target.single_(), recv);
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v === 'function') {
        return (...args: unknown[]) => {
          const r = (v as (...a: unknown[]) => unknown).apply(target, args);
          return r === target ? recv : r;
        };
      }
      return v;
    },
  });
}
