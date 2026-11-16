/**
 * push-dispatch — server-sent reminders (pg_cron every 5 minutes, service key only):
 *   - morning brief at the user's time        → opens /brief
 *   - evening review at the user's time       → opens /review
 *   - deadline reminders at each offset       → opens the task
 * Quiet hours postpone a notification to their end. Every notification is first recorded in
 * notification_log (unique per user + key) and only sent if that insert succeeded, so a
 * retried or overlapping run can never send a duplicate.
 */
import { type BriefBlock, type BriefTask, dueNotifications, type ReminderSettings } from '../_shared/brief-core.ts';
import { env, isServiceCall, serviceClient } from '../_shared/context.ts';
import { sendExpoPush, type PushMessage } from '../_shared/expo-push.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';
import type { Weekday } from '../_shared/planning/tz.ts';

const FN = 'push-dispatch';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isServiceCall(req)) return errorResponse('unauthorized', 401);

  const db = serviceClient();
  const now = Date.now();
  const { data: tokens } = await db.from('push_tokens').select('user_id, expo_push_token');
  const byUser = new Map<string, string[]>();
  for (const t of tokens ?? []) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.expo_push_token]);

  let total = 0;
  const invalidAll: string[] = [];
  for (const [userId, userTokens] of byUser) {
    const [profile, settings, tasks, blocks, capacity] = await Promise.all([
      db.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
      db
        .from('reminder_settings')
        .select(
          'morning_brief_time, evening_review_time, morning_brief_enabled, evening_review_enabled, deadline_offsets_minutes, quiet_start, quiet_end',
        )
        .eq('user_id', userId)
        .maybeSingle(),
      db
        .from('tasks')
        .select('id, title, space, priority, status, deadline_at, estimate_minutes, parent_task_id, created_at, completed_at')
        .eq('user_id', userId)
        .or(`status.in.(todo,doing),completed_at.gte.${new Date(now - 2 * 86_400_000).toISOString()}`),
      db
        .from('task_blocks')
        .select('id, task_id, start_at, end_at, status')
        .eq('user_id', userId)
        .in('status', ['accepted', 'synced', 'conflict'])
        .gt('end_at', new Date(now - 2 * 86_400_000).toISOString())
        .lt('start_at', new Date(now + 10 * 86_400_000).toISOString()),
      db.from('capacity_settings').select('space, weekday, max_focus_minutes').eq('user_id', userId),
    ]);
    if (!settings.data) continue;

    const due = dueNotifications({
      now,
      tz: profile.data?.timezone ?? 'Asia/Ho_Chi_Minh',
      tasks: (tasks.data ?? []) as BriefTask[],
      blocks: (blocks.data ?? []) as BriefBlock[],
      capacity: (capacity.data ?? []).map((c) => ({ space: c.space, weekday: c.weekday as Weekday, maxFocusMinutes: c.max_focus_minutes })),
      settings: settings.data as ReminderSettings,
    });
    if (due.length === 0) continue;

    // Claim each notification first (unique key) — only send the ones we claimed.
    const { data: claimed } = await db
      .from('notification_log')
      .upsert(
        due.map((n) => ({ user_id: userId, dedupe_key: n.key, kind: n.kind, payload_json: { url: n.url } })),
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
      )
      .select('dedupe_key');
    const claimedKeys = new Set((claimed ?? []).map((c) => c.dedupe_key));
    const messages: PushMessage[] = due
      .filter((n) => claimedKeys.has(n.key))
      .flatMap((n) =>
        userTokens.map((to) => ({ to, title: n.title, body: n.body, data: { url: n.url, kind: n.kind }, sound: 'default' as const })),
      );
    if (!messages.length) continue;
    try {
      const res = await sendExpoPush(messages, { accessToken: env('EXPO_ACCESS_TOKEN') });
      total += res.sent;
      invalidAll.push(...res.invalidTokens);
    } catch (e) {
      // Release the claims so the next run retries.
      await db
        .from('notification_log')
        .delete()
        .eq('user_id', userId)
        .in('dedupe_key', [...claimedKeys]);
      log(FN, { event: 'send_failed', message: e instanceof Error ? e.message.slice(0, 120) : 'unknown' });
    }
  }
  if (invalidAll.length) await db.from('push_tokens').delete().in('expo_push_token', invalidAll);
  log(FN, { event: 'done', users: byUser.size, sent: total, pruned: invalidAll.length });
  return json({ users: byUser.size, sent: total, pruned: invalidAll.length });
});
