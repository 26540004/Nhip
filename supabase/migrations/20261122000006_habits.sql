-- "Hồ sơ thói quen": what Nhịp learns about the user. Additive only.

-- Toggle + quick-start answers ({overrun, focus_study[], focus_work[]}).
create table public.habit_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  learning_enabled boolean not null default true,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger habit_settings_updated_at before update on public.habit_settings
  for each row execute function public.set_updated_at();

-- Abbreviations ("bt" = bài tập) and nicknames for subjects/projects ("mmt" → Mạng máy tính).
create table public.vocab_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  short text not null check (char_length(btrim(short)) between 1 and 40),
  meaning text not null check (char_length(btrim(meaning)) between 1 and 120),
  collection_id uuid references public.collections (id) on delete cascade,
  source text not null default 'user' check (source in ('user', 'learned', 'import')),
  short_key text generated always as (lower(btrim(short))) stored,
  created_at timestamptz not null default now(),
  unique (user_id, short_key)
);

-- What the user changed after Quick Add (replayed to the AI as examples). Last 30 kept.
create table public.ai_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  input_text text not null check (char_length(input_text) <= 500),
  field text not null check (field in ('collection', 'space', 'deadline', 'estimate', 'title')),
  ai_value text check (char_length(ai_value) <= 200),
  user_value text check (char_length(user_value) <= 200),
  created_at timestamptz not null default now()
);
create index ai_corrections_user_idx on public.ai_corrections (user_id, created_at desc);

create or replace function public.trim_ai_corrections() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from ai_corrections
   where user_id = new.user_id
     and id not in (select id from ai_corrections where user_id = new.user_id order by created_at desc limit 30);
  return null;
end $$;
create trigger ai_corrections_trim after insert on public.ai_corrections
  for each row execute function public.trim_ai_corrections();

-- RLS: own rows only; a nickname may only point at the user's own subject/project.
do $$
declare t text;
begin
  foreach t in array array['habit_settings', 'vocab_entries', 'ai_corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create policy habit_settings_insert_own on public.habit_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy habit_settings_update_own on public.habit_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy vocab_insert_own on public.vocab_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (collection_id is null or exists (select 1 from public.collections c where c.id = collection_id and c.user_id = (select auth.uid())))
  );
create policy vocab_update_own on public.vocab_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (collection_id is null or exists (select 1 from public.collections c where c.id = collection_id and c.user_id = (select auth.uid())))
  );

create policy ai_corrections_insert_own on public.ai_corrections for insert to authenticated with check (user_id = (select auth.uid()));
-- Corrections are append-only from the app (no update policy).

grant select, insert, update, delete on public.habit_settings, public.vocab_entries to authenticated;
grant select, insert, delete on public.ai_corrections to authenticated;
