/**
 * Mount once while signed in. Keeps local "start of block" reminders in sync with the
 * calendar (on data change and when the app returns to the foreground), registers the push
 * token, and routes notification taps / actions.
 */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useUpdateTask } from '../lib/api/mutations';
import { useBlocks, useSettings, useTasks } from '../lib/api/queries';
import { isDemo } from '../lib/api/supabase';
import type { ReminderBlock } from '../lib/notifications/local';
import {
  ACTION_SNOOZE,
  ACTION_START,
  configureNotifications,
  notificationsSupported,
  registerPushToken,
  routeFromUrl,
  snooze,
  syncLocalReminders,
} from '../lib/notifications/localAdapter';
import { rulesFromSettings } from '../lib/settings/rules';

export function useNotifications(): void {
  const enabled = notificationsSupported && !isDemo;
  const [range] = useState(() => ({
    from: new Date(Date.now() - 3_600_000).toISOString(),
    to: new Date(Date.now() + 21 * 86_400_000).toISOString(),
  }));
  const blocks = useBlocks(range.from, range.to).data;
  const tasks = useTasks().data;
  const settings = useSettings().data;
  const update = useUpdateTask();
  const [foregroundTick, setForegroundTick] = useState(0);

  const reminderBlocks: ReminderBlock[] = useMemo(() => {
    const byId = new Map((tasks ?? []).map((t) => [t.id, t]));
    return (blocks ?? []).flatMap((b) => {
      const t = byId.get(b.task_id);
      if (!t) return [];
      return [
        {
          id: b.id,
          taskId: t.id,
          title: t.title,
          start: Date.parse(b.start_at),
          end: Date.parse(b.end_at),
          status: b.status,
          taskDone: t.status === 'done' || t.status === 'dropped',
        },
      ];
    });
  }, [blocks, tasks]);

  // Setup + push token once.
  useEffect(() => {
    if (!enabled) return;
    void configureNotifications().then(() => registerPushToken().catch(() => null));
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setForegroundTick((n) => n + 1));
    return () => sub.remove();
  }, [enabled]);

  // Re-schedule when blocks/tasks/settings change or the app comes back.
  useEffect(() => {
    if (!enabled || !blocks || !tasks) return;
    const rules = rulesFromSettings(settings);
    void syncLocalReminders(reminderBlocks, {
      now: Date.now(),
      offsetMinutes: rules.startOffsetMinutes,
      quietHours: rules.quietHours,
      tz: rules.tz,
    }).catch(() => undefined);
  }, [enabled, reminderBlocks, settings, blocks, tasks, foregroundTick]);

  // Taps and action buttons.
  useEffect(() => {
    if (!enabled) return;
    const handle = (resp: Notifications.NotificationResponse) => {
      const content = resp.notification.request.content;
      const data = (content.data ?? {}) as Record<string, unknown>;
      if (resp.actionIdentifier === ACTION_SNOOZE) {
        void snooze(content);
        return;
      }
      if (resp.actionIdentifier === ACTION_START && typeof data.taskId === 'string') {
        update.mutate({ id: data.taskId, patch: { status: 'doing', completed_at: null } });
      }
      const path = routeFromUrl(data.url);
      if (path) router.push(path as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) handle(last);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
