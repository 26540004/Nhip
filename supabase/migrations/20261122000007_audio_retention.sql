-- Audio retention: once a recording has its transcript, the audio files are deleted
-- (now, on request, or automatically 14 days later). Transcript, summary and segment
-- rows stay; only the Storage objects go. Additive only.

alter table public.attachments
  add column audio_expires_at timestamptz,
  add column audio_deleted_at timestamptz;
-- Both are written by the transcribe-audio function only (not in the column grant).

create index attachments_audio_expiry_idx on public.attachments (audio_expires_at)
  where type = 'audio' and audio_deleted_at is null and audio_expires_at is not null;

-- Recordings already transcribed before this migration get the same 14 days from now.
update public.attachments
   set audio_expires_at = now() + interval '14 days'
 where type = 'audio' and transcript_status = 'done' and audio_expires_at is null;

-- Storage used by the signed-in user (bytes), for "Đã dùng x / 1 GB" in Settings.
create or replace function public.storage_usage() returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
    'audio', coalesce(sum(s) filter (where kind = 'audio'), 0),
    'image', coalesce(sum(s) filter (where kind = 'image'), 0),
    'other', coalesce(sum(s) filter (where kind = 'other'), 0)
  )
  from (
    select coalesce((metadata ->> 'size')::bigint, 0) as s,
           case when metadata ->> 'mimetype' like 'audio/%' then 'audio'
                when metadata ->> 'mimetype' like 'image/%' then 'image'
                else 'other' end as kind
      from storage.objects
     where bucket_id = 'attachments'
       and (storage.foldername(name))[1] = (select auth.uid())::text
  ) o
$$;
revoke execute on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
