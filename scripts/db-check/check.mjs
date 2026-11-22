import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Applies supabase/migrations to a throwaway Postgres (with stubs for Supabase-managed
// schemas: auth, storage, vault, cron, net) and checks RLS, search and server helpers.
// Usage: cd scripts/db-check && npm install && npm run check

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? path.join(here, '../../supabase/migrations');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhip-pg-'));
fs.chmodSync(dataDir, 0o777);
const pgs = new EmbeddedPostgres({ databaseDir: path.join(dataDir, 'data'), user: 'postgres', password: 'pw', port: 54329, persistent: false });
await pgs.initialise();
await pgs.start();
await pgs.createDatabase('t');
const c = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'pw', database: 't' });
await c.connect();

const stubs = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role; grant execute on function auth.uid() to authenticated, anon, service_role;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text, metadata jsonb);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create schema vault; create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (n, s, d) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create schema extensions; create schema net;
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;
grant usage on schema public to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to authenticated, anon, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
`;
await c.query(stubs);

for (const f of fs.readdirSync(dir).sort()) {
  let sql = fs.readFileSync(path.join(dir, f), 'utf8');
  sql = sql.replace(/create extension if not exists pg_cron;/, '').replace(/create extension if not exists pg_net with schema extensions;/, '');
  try {
    await c.query(sql);
    console.log('OK  ', f);
  } catch (e) {
    console.log('FAIL', f, e.message, e.position ? sql.slice(Math.max(0, e.position - 200), Number(e.position) + 50) : '');
    process.exitCode = 1;
  }
}

try {
if (!process.exitCode) {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const as = async (uid, fn) => {
    await c.query('begin');
    await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    try { return await fn(); } finally { await c.query('rollback'); }
  };
  const fails = async (sql, params) => { await c.query('savepoint s'); try { await c.query(sql, params); await c.query('release savepoint s'); return false; } catch { await c.query('rollback to savepoint s'); return true; } };
  const check = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };

  await q(`insert into auth.users(id, raw_user_meta_data) values ($1, '{"full_name":"An"}'), ($2, '{}')`, [A, B]);
  check((await q('select count(*)::int n from work_hours where user_id=$1', [A]))[0].n === 7, 'signup creates 7 work_hours rows');
  check((await q('select count(*)::int n from capacity_settings where user_id=$1', [A]))[0].n === 14, 'signup creates 14 capacity rows');
  check((await q('select display_name from profiles where id=$1', [A]))[0].display_name === 'An', 'profile display_name from metadata');

  // A creates data (committed, as superuser for setup with user_id A)
  const [col] = await q(`insert into collections(user_id, space, kind, name) values ($1,'study','subject','Mạng máy tính') returning id`, [A]);
  await q(`insert into tasks(user_id, space, collection_id, title, description) values ($1,'study',$2,'Báo cáo môn Mạng','Viết phần định tuyến')`, [A, col.id]);
  await q(`insert into notes(user_id, space, title, plain_text) values ($1,'study','Bài giảng đầu tiên','Giao thức TCP và đường truyền')`, [A]);

  await as(B, async () => {
    check((await q('select * from tasks')).length === 0, 'RLS: B cannot see A tasks');
    check((await q('select * from search_all($1)', ['bao cao'])).length === 0, 'RLS: B search returns nothing');
    const blocked = await fails(`insert into tasks(user_id, space, title) values ($1,'work','x')`, [A]);
    check(blocked, 'RLS: B cannot insert rows for A');
    const fkBlocked = await fails(`insert into tasks(space, title, collection_id) values ('study','x',$1)`, [col.id]);
    check(fkBlocked, "B cannot attach a task to A's collection");
  });

  await as(A, async () => {
    check((await q('select * from tasks')).length === 1, 'RLS: A sees own task');
    const r1 = await q('select kind, title from search_all($1)', ['bao cao mang']);
    check(r1.length === 1 && r1[0].kind === 'task', 'search without diacritics matches "Báo cáo môn Mạng"');
    const r2 = await q('select kind from search_all($1)', ['duong truy']);
    check(r2.length === 1 && r2[0].kind === 'note', 'prefix + đ→d search matches note "đường truyền"');
    const r3 = await q('select kind from search_all($1)', ["'):*&|!"]);
    check(r3.length === 0, 'garbage query is safe');
    const [t] = await q(`insert into tasks(space, title) values ('work','Gọi khách hàng A') returning id, user_id`);
    check(t.user_id === A, 'user_id defaults to auth.uid()');
    const colBlocked = await fails(`update profiles set daily_ai_calls = 0`);
    check(colBlocked, 'user cannot reset daily_ai_calls');
    await q(`update profiles set ai_privacy_mode = true`);
    const secretBlocked = await fails('select refresh_token_secret_id from google_connections');
    check(secretBlocked, 'vault secret id not selectable by user');
    const rpcBlocked = await fails('select read_google_refresh_token($1)', [A]);
    check(rpcBlocked, 'user cannot call read_google_refresh_token');
    const doneBad = await fails(`update tasks set status='done' where id=$1`, [t.id]);
    check(doneBad, 'done requires completed_at');
  });

  // service role helpers
  await q(`update profiles set daily_ai_calls = 0 where id = $1`, [A]);
  const calls = [];
  for (let i = 0; i < 3; i++) calls.push((await q('select consume_ai_call($1, 2) ok', [A]))[0].ok);
  check(JSON.stringify(calls) === '[true,true,false]', 'consume_ai_call enforces daily limit');
  await q(`select store_google_refresh_token($1, 'tok-1')`, [A]);
  await q(`select store_google_refresh_token($1, 'tok-2')`, [A]);
  check((await q('select read_google_refresh_token($1) t', [A]))[0].t === 'tok-2', 'refresh token stored/rotated in vault');
  check((await q('select count(*)::int n from vault.secrets'))[0].n === 1, 'single vault secret per user');
  await q('select delete_google_refresh_token($1)', [A]);
  check((await q('select count(*)::int n from vault.secrets'))[0].n === 0, 'disconnect deletes vault secret');

  // Habit profile (migration 006)
  await as(A, async () => {
    await q(`insert into habit_settings(answers) values ('{"overrun":"often"}')`);
    await q(`insert into vocab_entries(short, meaning, collection_id) values ('mmt','Mạng máy tính',$1)`, [col.id]);
    const dupCaught = await fails(`insert into vocab_entries(short, meaning) values (' MMT ','x')`);
    check(dupCaught, 'vocab: one entry per abbreviation (case/space-insensitive)');
    await q(`insert into vocab_entries(short, meaning) values ('MMT','x') on conflict (user_id, short_key) do nothing`);
    check((await q('select count(*)::int n from vocab_entries'))[0].n === 1, 'vocab: upsert on short_key ignores duplicates');
    for (let i = 0; i < 35; i++) await q(`insert into ai_corrections(input_text, field, user_value) values ($1,'collection','Mạng máy tính')`, [`câu ${i}`]);
    check((await q('select count(*)::int n from ai_corrections'))[0].n === 30, 'corrections trimmed to the last 30');
  });
  await as(B, async () => {
    check((await q('select * from vocab_entries')).length === 0 && (await q('select * from habit_settings')).length === 0, 'RLS: B cannot see A habit profile');
    const colBad = await fails(`insert into vocab_entries(short, meaning, collection_id) values ('x','y',$1)`, [col.id]);
    check(colBad, "B cannot point a nickname at A's subject");
    const forA = await fails(`insert into ai_corrections(user_id, input_text, field) values ($1,'x','space')`, [A]);
    check(forA, 'B cannot write corrections for A');
  });

  // Audio retention (migration 007)
  const [recNote] = await q(`insert into notes(user_id, space, title) values ($1,'study','Ghi âm') returning id`, [A]);
  const [audio] = await q(
    `insert into attachments(user_id, owner_type, owner_id, type, storage_path, transcript_status) values ($1,'note',$3,'audio',$2,'none') returning id`,
    [A, `${A}/rec/seg-000.m4a`, recNote.id],
  );
  await q(`insert into storage.objects(bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, '{"size": 3000000, "mimetype": "audio/mp4"}'), ('attachments', $3, $2, '{"size": 400000, "mimetype": "image/jpeg"}'), ('attachments', $4, $5, '{"size": 9999999, "mimetype": "audio/mp4"}')`,
    [`${A}/rec/seg-000.m4a`, A, `${A}/img/1.jpg`, `${B}/rec/x.m4a`, B]);
  await as(A, async () => {
    const [{ storage_usage: u }] = await q('select public.storage_usage()');
    check(u.audio === 3000000 && u.image === 400000, 'storage_usage counts only my own files', JSON.stringify(u));
    const cantSet = await fails(`update attachments set audio_deleted_at = now() where id = $1`, [audio.id]);
    check(cantSet, 'app cannot mark audio deleted itself (server only)');
  });
  await c.query('begin'); await c.query('set local role anon');
  check(await fails('select public.storage_usage()'), 'anon cannot read storage usage');
  await c.query('rollback');
}

} catch (e) { console.log('FAIL exception', e.message); process.exitCode = 1; }
await c.end();
await pgs.stop();
fs.rmSync(dataDir, { recursive: true, force: true });
