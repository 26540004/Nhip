/**
 * expo-notifications adapter (iOS). Applies the pure scheduler's diff (local.ts), handles
 * the "Bắt đầu" / "Hoãn 15 phút" actions and registers the Expo push token for
 * server-sent reminders. Web has no local notifications: every function is a no-op there.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { vi } from '../../i18n/vi';
import { requireSupabase } from '../api/supabase';
import { desiredReminders, diffReminders, type ReminderBlock, type ReminderOptions } from './local';

export const BLOCK_CATEGORY = 'block-start';
export const ACTION_START = 'start';
export const ACTION_SNOOZE = 'snooze';
const SNOOZE_MINUTES = 15;

export const notificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

let configured = false;

/** Foreground presentation + action buttons. Idempotent. */
export async function configureNotifications(): Promise<void> {
  if (!notificationsSupported || configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  await Notifications.setNotificationCategoryAsync(BLOCK_CATEGORY, [
    { identifier: ACTION_START, buttonTitle: vi.notifications.actionStart, options: { opensAppToForeground: true } },
    { identifier: ACTION_SNOOZE, buttonTitle: vi.notifications.actionSnooze, options: { opensAppToForeground: false } },
  ]);
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPermission(): Promise<PermissionState> {
  if (!notificationsSupported) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  if (!notificationsSupported) return 'unsupported';
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return p.granted ? 'granted' : 'denied';
}

/** Re-schedule "start of block" reminders: cancel stale ones, add missing ones (≤ 50). */
export async function syncLocalReminders(
  blocks: readonly ReminderBlock[],
  opts: ReminderOptions,
): Promise<{ scheduled: number; cancelled: number }> {
  if (!notificationsSupported || (await getPermission()) !== 'granted') return { scheduled: 0, cancelled: 0 };
  const desired = desiredReminders(blocks, opts);
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  // Only manage our block reminders; snoozes are one-offs that clean themselves up.
  const mine = pending.filter((p) => p.identifier.startsWith('block:')).map((p) => ({ id: p.identifier }));
  const diff = diffReminders(mine, desired);
  for (const id of diff.cancel) await Notifications.cancelScheduledNotificationAsync(id);
  for (const r of diff.schedule) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: r.data, sound: 'default', categoryIdentifier: BLOCK_CATEGORY },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.fireAt) },
    });
  }
  return { scheduled: diff.schedule.length, cancelled: diff.cancel.length };
}

/** "Hoãn 15 phút": the same reminder again in 15 minutes. */
export async function snooze(content: Notifications.NotificationContent): Promise<void> {
  const data = (content.data ?? {}) as Record<string, unknown>;
  await Notifications.scheduleNotificationAsync({
    identifier: `snooze:${String(data.blockId ?? '')}:${Date.now()}`,
    content: { title: content.title, body: content.body, data, sound: 'default', categoryIdentifier: BLOCK_CATEGORY },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: SNOOZE_MINUTES * 60 },
  });
}

export { routeFromUrl } from './links';

/** Save this device's Expo push token so push-dispatch can reach it. */
export async function registerPushToken(): Promise<string | null> {
  if (!notificationsSupported || (await getPermission()) !== 'granted') return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null; // dev build without EAS project id: local reminders still work
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const db = requireSupabase();
  const { data } = await db.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  await db
    .from('push_tokens')
    .upsert({ user_id: uid, expo_push_token: token, platform: Platform.OS, updated_at: new Date().toISOString() });
  return token;
}
