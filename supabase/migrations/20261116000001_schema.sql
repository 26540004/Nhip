-- Nhịp — core schema.
-- All timestamps are timestamptz (stored UTC). Local wall-clock rules (office hours,
-- class sessions, windows) are `time` values interpreted in profiles.timezone.
-- Every row is scoped by user_id; RLS is enabled in the next migration.

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  ai_privacy_mode boolean not null default false,
  daily_ai_calls integer not null default 0,
  daily_ai_calls_date date not null default current_date,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile + sensible defaults whenever a user signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;

  -- Office hours Mon–Fri 08:00–17:00, lunch 12:00–13:00; weekend disabled.
  insert into public.work_hours (user_id, weekday, start_time, end_time, break_start, break_end, enabled)
  select new.id, d, '08:00', '17:00', '12:00', '13:00', d between 1 and 5
  from generate_series(0, 6) as d
  on conflict do nothing;

  -- Study windows: weekday evenings 19:00–22:30, weekends 08:00–22:00.
  insert into public.study_windows (user_id, weekday, start_time, end_time)
  select new.id, d,
         case when d in (0, 6) then time '08:00' else time '19:00' end,
         case when d in (0, 6) then time '22:00' else time '22:30' end
  from generate_series(0, 6) as d;

  -- Capacity: work 360 on weekdays (0 weekend), study 150 weekdays / 300 weekends.
  insert into public.capacity_settings (user_id, space, weekday, max_focus_minutes)
  select new.id, s, d,
         case when s = 'work' then (case when d between 1 and 5 then 360 else 0 end)
              else (case when d between 1 and 5 then 150 else 300 end) end
  from generate_series(0, 6) as d cross join (values ('work'), ('study')) as sp(s)
  on conflict do nothing;

  insert into public.reminder_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- collections (subjects / projects)
-- ---------------------------------------------------------------------------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space text not null check (space in ('study', 'work')),
  kind text not null check (kind in ('subject', 'project')),
  name text not null check (length(name) between 1 and 120),
  color_variant smallint not null default 0 check (color_variant between 0 and 7),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_kind_matches_space check (
    (space = 'study' and kind = 'subject') or (space = 'work' and kind = 'project')
  )
);
create index collections_user_idx on public.collections (user_id, space) where not archived;
create trigger collections_updated_at before update on public.collections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- notes (before tasks: tasks.source_note_id references notes)
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space text not null check (space in ('study', 'work')),
  collection_id uuid references public.collections (id) on delete set null,
  title text not null default '',
  content_json jsonb not null default '{}'::jsonb,
  plain_text text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user_idx on public.notes (user_id, pinned desc, updated_at desc);
create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space text not null check (space in ('study', 'work')),
  collection_id uuid references public.collections (id) on delete set null,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null check (length(title) between 1 and 500),
  description text,
  deadline_at timestamptz,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 10000),
  priority smallint not null default 2 check (priority between 1 and 3),
  priority_reason text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done', 'dropped')),
  source text not null default 'form' check (source in ('quick_add', 'form', 'note', 'ai_split')),
  source_note_id uuid references public.notes (id) on delete set null,
  -- Quick Add saved without AI parsing ("Chưa phân tích").
  needs_parse boolean not null default false,
  sort_order double precision not null default 0,
  completed_at timestamptz,
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_completed_consistent check ((status = 'done') = (completed_at is not null))
);
create index tasks_user_status_deadline_idx on public.tasks (user_id, status, deadline_at);
create index tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null;
create index tasks_collection_idx on public.tasks (collection_id);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_proposals (before task_blocks: blocks reference proposals)
-- ---------------------------------------------------------------------------
create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  range_start timestamptz not null,
  range_end timestamptz not null,
  request_context_json jsonb not null default '{}'::jsonb,
  response_json jsonb,
  validation_report_json jsonb,
  provider text,
  model text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'applied')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  check (range_end > range_start)
);
create index ai_proposals_user_idx on public.ai_proposals (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- task_blocks
-- ---------------------------------------------------------------------------
create table public.task_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'synced', 'rejected', 'conflict')),
  proposal_id uuid references public.ai_proposals (id) on delete set null,
  reason text,
  gcal_event_id text,
  gcal_calendar_id text,
  gcal_etag text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index task_blocks_user_time_idx on public.task_blocks (user_id, start_at) where status in ('accepted', 'synced', 'conflict');
create index task_blocks_task_idx on public.task_blocks (task_id);
create unique index task_blocks_gcal_event_uidx on public.task_blocks (user_id, gcal_calendar_id, gcal_event_id)
  where gcal_event_id is not null;
create trigger task_blocks_updated_at before update on public.task_blocks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_type text not null check (owner_type in ('note', 'task')),
  owner_id uuid not null,
  type text not null check (type in ('image', 'audio', 'link', 'file')),
  storage_path text,
  url text,
  title text,
  meta_json jsonb not null default '{}'::jsonb,
  duration_sec integer,
  bookmarks_json jsonb not null default '[]'::jsonb,
  -- Audio is uploaded in segments: [{index, storage_path, duration_sec, uploaded, transcript_status}]
  segments_json jsonb not null default '[]'::jsonb,
  transcript_status text not null default 'none'
    check (transcript_status in ('none', 'processing', 'done', 'failed')),
  transcript_text text,
  summary_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path is not null or url is not null)
);
create index attachments_owner_idx on public.attachments (owner_type, owner_id);
create index attachments_user_idx on public.attachments (user_id, created_at desc);
create trigger attachments_updated_at before update on public.attachments
  for each row execute function public.set_updated_at();

-- Polymorphic owner check (FKs can't target two tables): owner must belong to the same user.
create or replace function public.check_attachment_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_type = 'note' and not exists (select 1 from notes where id = new.owner_id and user_id = new.user_id) then
    raise exception 'attachment owner note not found';
  elsif new.owner_type = 'task' and not exists (select 1 from tasks where id = new.owner_id and user_id = new.user_id) then
    raise exception 'attachment owner task not found';
  end if;
  return new;
end $$;
create trigger attachments_owner_check before insert or update of owner_type, owner_id on public.attachments
  for each row execute function public.check_attachment_owner();

-- Clean attachments when their owner is deleted.
create or replace function public.delete_owned_attachments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from attachments where owner_id = old.id and owner_type = tg_argv[0];
  return old;
end $$;
create trigger notes_delete_attachments after delete on public.notes
  for each row execute function public.delete_owned_attachments('note');
create trigger tasks_delete_attachments after delete on public.tasks
  for each row execute function public.delete_owned_attachments('task');

-- ---------------------------------------------------------------------------
-- Weekly rules
-- ---------------------------------------------------------------------------
create table public.work_hours (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  break_start time,
  break_end time,
  enabled boolean not null default true,
  primary key (user_id, weekday),
  check (end_time > start_time),
  check ((break_start is null) = (break_end is null)),
  check (break_start is null or (break_start >= start_time and break_end <= end_time and break_end > break_start))
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection_id uuid not null references public.collections (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  location text,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index class_sessions_user_idx on public.class_sessions (user_id, weekday);

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  class_session_id uuid references public.class_sessions (id) on delete cascade,
  date date not null,
  type text not null check (type in ('cancelled', 'moved', 'extra')),
  new_start_at timestamptz,
  new_end_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  check (type = 'cancelled' or (new_start_at is not null and new_end_at > new_start_at)),
  check (type = 'extra' or class_session_id is not null)
);
create index schedule_exceptions_user_date_idx on public.schedule_exceptions (user_id, date);

-- Study windows may cross midnight (end_time <= start_time means "ends next day").
create table public.study_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time <> start_time)
);
create index study_windows_user_idx on public.study_windows (user_id, weekday);

create table public.capacity_settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space text not null check (space in ('study', 'work')),
  weekday smallint not null check (weekday between 0 and 6),
  max_focus_minutes integer not null check (max_focus_minutes between 0 and 1440),
  primary key (user_id, space, weekday)
);

create table public.reminder_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  morning_brief_time time not null default '07:00',
  evening_review_time time not null default '21:30',
  morning_brief_enabled boolean not null default true,
  evening_review_enabled boolean not null default true,
  -- Minutes before deadline: 7 days, 1 day.
  deadline_offsets_minutes integer[] not null default array[10080, 1440],
  start_offset_minutes integer not null default 10 check (start_offset_minutes between 0 and 240),
  quiet_start time default '23:00',
  quiet_end time default '06:30',
  updated_at timestamptz not null default now()
);
create trigger reminder_settings_updated_at before update on public.reminder_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Google Calendar
-- ---------------------------------------------------------------------------
create table public.google_connections (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  google_email text,
  -- Refresh token lives in Supabase Vault; only its secret id is stored here.
  refresh_token_secret_id uuid,
  scopes text[] not null default '{}',
  read_calendar_ids text[] not null default '{}',
  target_calendar_id text,
  sync_tokens_json jsonb not null default '{}'::jsonb,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'syncing', 'error', 'revoked')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger google_connections_updated_at before update on public.google_connections
  for each row execute function public.set_updated_at();

create table public.busy_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_calendar_id text not null,
  gcal_event_id text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  title text,
  all_day boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, source_calendar_id, gcal_event_id)
);
create index busy_cache_user_time_idx on public.busy_cache (user_id, start_at, end_at);

-- ---------------------------------------------------------------------------
-- Push
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now(),
  primary key (user_id, expo_push_token)
);

-- Dedup log: one row per logical notification (e.g. 'deadline:<task>:1440', 'brief:2026-11-16').
create table public.notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  dedupe_key text not null,
  kind text not null check (kind in ('morning_brief', 'evening_review', 'deadline')),
  payload_json jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

-- ---------------------------------------------------------------------------
-- Signup trigger (defined last: it inserts into tables above)
-- ---------------------------------------------------------------------------
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
