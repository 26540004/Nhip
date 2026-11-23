-- Claude auto-fix for the admin account only. Additive only.

-- Who is admin: set once by the owner with the service role / SQL editor, never from the app:
--   insert into public.app_admins(user_id) values ('<your user id>');
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
alter table public.app_admins force row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = (select auth.uid()))
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Scrubbed reports, grouped by fingerprint (written by report-error with the service role).
create table public.error_reports (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{8}$'),
  kind text not null check (kind in ('crash', 'error', 'function', 'manual')),
  title text not null,
  body text not null,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  issue_number int,
  last_comment_at timestamptz
);
alter table public.error_reports enable row level security;
alter table public.error_reports force row level security;
revoke all on public.error_reports from anon, authenticated;

-- Per-hour budget so a crash loop can't flood GitHub (or the admin's Claude usage).
create table public.error_report_budget (
  hour timestamptz primary key,
  n int not null default 0
);
alter table public.error_report_budget enable row level security;
alter table public.error_report_budget force row level security;
revoke all on public.error_report_budget from anon, authenticated;
