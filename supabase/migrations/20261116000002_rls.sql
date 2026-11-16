-- Row Level Security: every table is scoped to auth.uid().
-- `(select auth.uid())` is used so Postgres evaluates it once per statement.

-- Tables the user fully owns (select/insert/update/delete own rows).
do $$
declare t text;
begin
  foreach t in array array[
    'collections', 'notes', 'tasks', 'task_blocks', 'attachments',
    'work_hours', 'class_sessions', 'schedule_exceptions', 'study_windows',
    'capacity_settings', 'reminder_settings', 'push_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t || '_select_own', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t || '_insert_own', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t || '_update_own', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))$p$, t || '_delete_own', t);
  end loop;
end $$;

-- Referenced rows must belong to the same user (RLS alone doesn't stop pointing an FK at
-- someone else's row id). Enforced with a trigger on the tables that hold such FKs.
create or replace function public.enforce_same_owner() returns trigger
language plpgsql security definer set search_path = public as $$
-- Each branch only touches columns of its own table (plpgsql resolves NEW fields per statement).
begin
  if tg_table_name in ('tasks', 'notes') then
    if new.collection_id is not null
       and not exists (select 1 from collections c where c.id = new.collection_id and c.user_id = new.user_id) then
      raise exception 'collection does not belong to user';
    end if;
  end if;
  if tg_table_name = 'tasks' then
    if new.parent_task_id is not null
       and not exists (select 1 from tasks p where p.id = new.parent_task_id and p.user_id = new.user_id) then
      raise exception 'parent task does not belong to user';
    end if;
    if new.source_note_id is not null
       and not exists (select 1 from notes n where n.id = new.source_note_id and n.user_id = new.user_id) then
      raise exception 'source note does not belong to user';
    end if;
  elsif tg_table_name = 'task_blocks' then
    if not exists (select 1 from tasks k where k.id = new.task_id and k.user_id = new.user_id) then
      raise exception 'task does not belong to user';
    end if;
  elsif tg_table_name = 'class_sessions' then
    if not exists (select 1 from collections c where c.id = new.collection_id and c.user_id = new.user_id) then
      raise exception 'collection does not belong to user';
    end if;
  elsif tg_table_name = 'schedule_exceptions' then
    if new.class_session_id is not null
       and not exists (select 1 from class_sessions s where s.id = new.class_session_id and s.user_id = new.user_id) then
      raise exception 'class session does not belong to user';
    end if;
  end if;
  return new;
end $$;

create trigger tasks_same_owner before insert or update on public.tasks for each row execute function public.enforce_same_owner();
create trigger notes_same_owner before insert or update on public.notes for each row execute function public.enforce_same_owner();
create trigger task_blocks_same_owner before insert or update on public.task_blocks for each row execute function public.enforce_same_owner();
create trigger class_sessions_same_owner before insert or update on public.class_sessions for each row execute function public.enforce_same_owner();
create trigger schedule_exceptions_same_owner before insert or update on public.schedule_exceptions for each row execute function public.enforce_same_owner();

-- profiles: read own; update only user-editable columns.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (display_name, timezone, ai_privacy_mode, onboarding_completed_at) on public.profiles to authenticated;

-- ai_proposals: created by the propose-plan function (service role); user reads and marks reviewed/applied.
alter table public.ai_proposals enable row level security;
alter table public.ai_proposals force row level security;
create policy ai_proposals_select_own on public.ai_proposals for select to authenticated using (user_id = (select auth.uid()));
create policy ai_proposals_update_own on public.ai_proposals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.ai_proposals from authenticated;
grant update (status) on public.ai_proposals to authenticated;

-- google_connections: tokens are managed by gcal-auth (service role). User may only pick calendars.
alter table public.google_connections enable row level security;
alter table public.google_connections force row level security;
create policy google_connections_select_own on public.google_connections for select to authenticated using (user_id = (select auth.uid()));
create policy google_connections_update_own on public.google_connections for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.google_connections from authenticated;
grant update (read_calendar_ids, target_calendar_id) on public.google_connections to authenticated;
-- The Vault secret id is server-only.
revoke select on public.google_connections from authenticated;
grant select (user_id, google_email, scopes, read_calendar_ids, target_calendar_id, status, last_error, last_synced_at, created_at, updated_at)
  on public.google_connections to authenticated;

-- busy_cache and notification_log: written by Edge Functions only; user can read.
alter table public.busy_cache enable row level security;
alter table public.busy_cache force row level security;
create policy busy_cache_select_own on public.busy_cache for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.busy_cache from authenticated;

alter table public.notification_log enable row level security;
alter table public.notification_log force row level security;
create policy notification_log_select_own on public.notification_log for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.notification_log from authenticated;

-- Nothing is readable anonymously.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Server-only helpers (service_role). Edge Functions call these via RPC.
-- ---------------------------------------------------------------------------

-- Per-user daily AI call counter. Returns false when the limit is reached.
create or replace function public.consume_ai_call(p_user uuid, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone coalesce((select timezone from profiles where id = p_user), 'Asia/Ho_Chi_Minh'))::date;
  allowed boolean;
begin
  update profiles
     set daily_ai_calls = case when daily_ai_calls_date = today then daily_ai_calls + 1 else 1 end,
         daily_ai_calls_date = today
   where id = p_user
     and (daily_ai_calls_date <> today or daily_ai_calls < p_limit)
  returning true into allowed;
  return coalesce(allowed, false);
end $$;

-- Store / replace the Google refresh token in Vault; keeps only the secret id in the table.
create or replace function public.store_google_refresh_token(p_user uuid, p_token text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare
  existing uuid;
  sid uuid;
begin
  select refresh_token_secret_id into existing from google_connections where user_id = p_user;
  if existing is not null then
    perform vault.update_secret(existing, p_token);
    sid := existing;
  else
    sid := vault.create_secret(p_token, 'google_refresh_' || p_user::text, 'Google refresh token for Nhịp user');
  end if;
  insert into google_connections (user_id, refresh_token_secret_id, status)
  values (p_user, sid, 'connected')
  on conflict (user_id) do update set refresh_token_secret_id = excluded.refresh_token_secret_id, status = 'connected', last_error = null;
  return sid;
end $$;

create or replace function public.read_google_refresh_token(p_user uuid) returns text
language sql security definer set search_path = public, vault as $$
  select s.decrypted_secret
    from google_connections g
    join vault.decrypted_secrets s on s.id = g.refresh_token_secret_id
   where g.user_id = p_user;
$$;

create or replace function public.delete_google_refresh_token(p_user uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  select refresh_token_secret_id into sid from google_connections where user_id = p_user;
  if sid is not null then
    delete from vault.secrets where id = sid;
  end if;
  update google_connections
     set refresh_token_secret_id = null, status = 'disconnected', sync_tokens_json = '{}'::jsonb
   where user_id = p_user;
  delete from busy_cache where user_id = p_user;
end $$;

revoke execute on function public.consume_ai_call(uuid, integer) from public, anon, authenticated;
revoke execute on function public.store_google_refresh_token(uuid, text) from public, anon, authenticated;
revoke execute on function public.read_google_refresh_token(uuid) from public, anon, authenticated;
revoke execute on function public.delete_google_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_call(uuid, integer) to service_role;
grant execute on function public.store_google_refresh_token(uuid, text) to service_role;
grant execute on function public.read_google_refresh_token(uuid) to service_role;
grant execute on function public.delete_google_refresh_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects under '<user_id>/...'
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 104857600)
on conflict (id) do update set public = false;

create policy attachments_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
