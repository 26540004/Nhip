-- Phase 5: media (images, audio recordings, link previews) and transcription.
-- Additive only: no existing column changes meaning.

-- ---------------------------------------------------------------------------
-- Storage paths must live under the owner's folder. Edge Functions read objects with the
-- service role, so a row must never point at another user's file.
-- ---------------------------------------------------------------------------
alter table public.attachments
  add constraint attachments_storage_path_owner
  check (storage_path is null or split_part(storage_path, '/', 1) = user_id::text);

-- Transcript / summary columns are written by the transcribe-audio function only.
revoke update on public.attachments from authenticated;
grant update (owner_type, owner_id, title, url, storage_path, meta_json, duration_sec, bookmarks_json)
  on public.attachments to authenticated;

-- ---------------------------------------------------------------------------
-- audio_segments: one row per ~10-minute piece of a recording.
-- The phone uploads each segment as soon as it is closed, so a 2-hour lecture is never one
-- big fragile upload, and transcription can start before the recording ends.
-- ---------------------------------------------------------------------------
create table public.audio_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  seq integer not null check (seq >= 0 and seq < 1000),
  storage_path text not null check (split_part(storage_path, '/', 1) = user_id::text),
  mime text not null default 'audio/mp4' check (mime in ('audio/mp4', 'audio/m4a', 'audio/aac', 'audio/webm', 'audio/mpeg', 'audio/wav')),
  start_offset_sec numeric(10, 2) not null default 0 check (start_offset_sec >= 0),
  duration_sec numeric(10, 2) not null default 0 check (duration_sec >= 0),
  uploaded boolean not null default false,
  -- none → pending (transcription requested) → processing → done | failed
  transcript_status text not null default 'none'
    check (transcript_status in ('none', 'pending', 'processing', 'done', 'failed')),
  -- [{ "t": seconds from the start of the whole recording, "text": "..." }]
  transcript_json jsonb,
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attachment_id, seq)
);
create index audio_segments_work_idx on public.audio_segments (transcript_status, next_attempt_at) where uploaded;
create trigger audio_segments_updated_at before update on public.audio_segments
  for each row execute function public.set_updated_at();

alter table public.audio_segments enable row level security;
alter table public.audio_segments force row level security;
create policy audio_segments_select_own on public.audio_segments for select to authenticated using (user_id = (select auth.uid()));
create policy audio_segments_insert_own on public.audio_segments for insert to authenticated with check (user_id = (select auth.uid()));
create policy audio_segments_update_own on public.audio_segments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy audio_segments_delete_own on public.audio_segments for delete to authenticated using (user_id = (select auth.uid()));

-- The client creates segments and marks them uploaded; transcription state is server-owned.
revoke insert, update on public.audio_segments from authenticated;
grant insert (id, attachment_id, seq, storage_path, mime, start_offset_sec, duration_sec, uploaded)
  on public.audio_segments to authenticated;
grant update (uploaded, duration_sec) on public.audio_segments to authenticated;
revoke all on public.audio_segments from anon;

-- Segment must belong to an audio attachment of the same user. New segments of a recording
-- that is already being transcribed join the queue automatically.
create or replace function public.audio_segment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  att record;
begin
  select user_id, type, transcript_status into att from attachments where id = new.attachment_id;
  if att is null or att.user_id <> new.user_id or att.type <> 'audio' then
    raise exception 'audio attachment not found';
  end if;
  if tg_op = 'INSERT' and att.transcript_status = 'processing' and new.transcript_status = 'none' then
    new.transcript_status := 'pending';
  end if;
  return new;
end $$;
create trigger audio_segments_guard before insert or update of attachment_id on public.audio_segments
  for each row execute function public.audio_segment_guard();

-- ---------------------------------------------------------------------------
-- Work queue for transcribe-audio. Claims the next uploaded, due segment (lowest seq first)
-- while never running two segments of the same recording at once. Stale claims (a worker
-- that died mid-request) are reclaimed after 5 minutes.
-- ---------------------------------------------------------------------------
create or replace function public.claim_audio_segment(p_attachment uuid default null)
returns setof public.audio_segments
language plpgsql security definer set search_path = public as $$
begin
  return query
  update audio_segments s
     set transcript_status = 'processing', claimed_at = now(), attempts = s.attempts + 1
   where s.id = (
     select c.id from audio_segments c
      where c.uploaded
        and (p_attachment is null or c.attachment_id = p_attachment)
        and (
          (c.transcript_status = 'pending' and c.next_attempt_at <= now())
          or (c.transcript_status = 'processing' and c.claimed_at < now() - interval '5 minutes')
        )
        and not exists (
          select 1 from audio_segments o
           where o.attachment_id = c.attachment_id and o.id <> c.id
             and o.transcript_status = 'processing' and o.claimed_at >= now() - interval '5 minutes'
        )
      order by c.next_attempt_at, c.seq
      limit 1
      for update skip locked
   )
  returning s.*;
end $$;
revoke execute on function public.claim_audio_segment(uuid) from public, anon, authenticated;
grant execute on function public.claim_audio_segment(uuid) to service_role;

-- Keep transcription moving while the phone is closed: every minute, only when work exists.
select cron.schedule('nhip-transcribe', '* * * * *', $$
  select public.invoke_edge_function('transcribe-audio', '{"mode":"cron"}')
   where exists (
     select 1 from public.audio_segments
      where uploaded and transcript_status in ('pending', 'processing') and next_attempt_at <= now()
   ) or exists (
     select 1 from public.attachments
      where type = 'audio' and transcript_status = 'processing' and updated_at > now() - interval '2 days'
   )
$$);
