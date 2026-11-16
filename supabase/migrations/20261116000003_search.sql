-- Full-text search across tasks, notes and transcripts.
-- 'simple' config + unaccent so "bao cao mang" matches "Báo cáo môn Mạng".

-- unaccent() is STABLE; generated columns need an IMMUTABLE wrapper with an explicit dictionary.
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe strict
set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- Vietnamese 'đ' is not decomposed by unaccent's default rules on every platform; map it explicitly.
create or replace function public.f_search_text(text) returns text
language sql immutable parallel safe strict
set search_path = '' as $$
  select translate(lower(public.f_unaccent($1)), 'đ', 'd')
$$;

alter table public.tasks add column search_tsv tsvector
  generated always as (to_tsvector('simple', public.f_search_text(coalesce(title, '') || ' ' || coalesce(description, '')))) stored;
alter table public.notes add column search_tsv tsvector
  generated always as (to_tsvector('simple', public.f_search_text(coalesce(title, '') || ' ' || coalesce(plain_text, '')))) stored;
alter table public.attachments add column search_tsv tsvector
  generated always as (to_tsvector('simple', public.f_search_text(coalesce(title, '') || ' ' || coalesce(transcript_text, '')))) stored;

create index tasks_search_idx on public.tasks using gin (search_tsv);
create index notes_search_idx on public.notes using gin (search_tsv);
create index attachments_search_idx on public.attachments using gin (search_tsv);

-- Prefix query from free text: "bao ca" → 'bao:* & ca:*'. Non-alphanumerics are dropped,
-- so user input can never produce a tsquery syntax error.
create or replace function public.build_prefix_tsquery(q text) returns tsquery
language sql immutable parallel safe
set search_path = '' as $$
  select case when count(*) = 0 then null
              else to_tsquery('simple', string_agg(tok || ':*', ' & '))
         end
    from regexp_split_to_table(public.f_search_text(coalesce(q, '')), '[^[:alnum:]]+') as tok
   where tok <> ''
$$;

-- Search RPC. SECURITY INVOKER → RLS restricts results to the caller's rows.
create or replace function public.search_all(q text, max_results integer default 30)
returns table (kind text, id uuid, owner_id uuid, title text, snippet text, rank real, updated_at timestamptz)
language sql stable security invoker
set search_path = public as $$
  with query as (select public.build_prefix_tsquery(q) as tsq)
  select * from (
    select 'task'::text, t.id, null::uuid, t.title,
           left(coalesce(t.description, ''), 160), ts_rank(t.search_tsv, query.tsq), t.updated_at
      from tasks t, query
     where query.tsq is not null and t.search_tsv @@ query.tsq
    union all
    select 'note', n.id, null, n.title, left(n.plain_text, 160), ts_rank(n.search_tsv, query.tsq), n.updated_at
      from notes n, query
     where query.tsq is not null and n.search_tsv @@ query.tsq
    union all
    select 'transcript', a.id, a.owner_id, coalesce(a.title, ''), left(coalesce(a.transcript_text, ''), 160),
           ts_rank(a.search_tsv, query.tsq), a.updated_at
      from attachments a, query
     where query.tsq is not null and a.search_tsv @@ query.tsq and a.type = 'audio'
  ) r (kind, id, owner_id, title, snippet, rank, updated_at)
  order by rank desc, updated_at desc
  limit least(greatest(max_results, 1), 100)
$$;

grant execute on function public.search_all(text, integer) to authenticated;
