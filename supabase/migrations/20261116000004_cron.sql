-- Scheduled jobs (pg_cron + pg_net). Jobs call Edge Functions with the service role key.
--
-- Before this works, store two secrets in Vault (Dashboard → Project Settings → Vault,
-- or SQL below — see README "Cron"):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
-- Until the corresponding functions are deployed, calls simply return 404 and are ignored.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_edge_function(fn text, body jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  key text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
begin
  if base is null or key is null then
    raise warning 'invoke_edge_function: project_url / service_role_key missing in Vault';
    return null;
  end if;
  return net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body := body,
    timeout_milliseconds := 30000
  );
end $$;
revoke execute on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;

-- Incremental Google Calendar sync for all connected users.
select cron.schedule('nhip-gcal-sync', '*/15 * * * *', $$select public.invoke_edge_function('gcal-sync', '{"mode":"cron"}')$$);

-- Due notifications: morning brief, evening review, deadline reminders (deduped via notification_log).
select cron.schedule('nhip-push-dispatch', '*/5 * * * *', $$select public.invoke_edge_function('push-dispatch', '{}')$$);

-- Housekeeping: drop rejected proposals' blocks and old proposals after 30 days, old logs after 90.
select cron.schedule('nhip-cleanup', '17 3 * * *', $$
  delete from public.task_blocks where status in ('proposed', 'rejected') and updated_at < now() - interval '30 days';
  delete from public.ai_proposals where created_at < now() - interval '30 days' and status <> 'applied';
  delete from public.notification_log where sent_at < now() - interval '90 days';
$$);
