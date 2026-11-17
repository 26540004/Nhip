/** Cards shown at the top of Today: morning brief (until dismissed for the day) and the notification prompt. */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { buildBrief } from '../../../supabase/functions/_shared/brief-core.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { vi } from '../../i18n/vi';
import { isDemo } from '../../lib/api/supabase';
import { getPermission, type PermissionState, registerPushToken, requestPermission } from '../../lib/notifications/localAdapter';
import { useUiStore } from '../../stores/ui';
import { spacing } from '../../theme/tokens';
import { useBriefInput } from './useBriefData';

export function MorningBriefCard() {
  const { input, ready } = useBriefInput();
  const dismissed = useUiStore((s) => s.briefDismissedDate);
  const dismiss = useUiStore((s) => s.dismissBrief);
  if (!ready) return null;
  const brief = buildBrief(input);
  if (dismissed === brief.date) return null;
  return (
    <Card ai>
      <AppText variant="meta" tone="primary">
        {vi.brief.title.toUpperCase()}
      </AppText>
      <AppText variant="body" tone="heading">
        {brief.summary}
      </AppText>
      {brief.top.map((t, i) => (
        <AppText key={t.id} variant="secondary" numberOfLines={2}>
          {`${i + 1}. ${t.title} — ${t.reason}`}
        </AppText>
      ))}
      <View style={styles.row}>
        <Button label={vi.brief.viewFull} variant="secondary" onPress={() => router.push('/brief')} style={styles.grow} />
        <Button label={vi.brief.dismiss} variant="ghost" onPress={() => dismiss(brief.date)} />
      </View>
    </Card>
  );
}

export function NotificationPromptCard() {
  const [perm, setPerm] = useState<PermissionState>('unsupported');
  const dismissed = useUiStore((s) => s.notifPromptDismissed);
  const dismiss = useUiStore((s) => s.dismissNotifPrompt);
  useEffect(() => {
    if (!isDemo) void getPermission().then(setPerm);
  }, []);
  if (dismissed || perm !== 'undetermined') return null;
  return (
    <Card>
      <AppText variant="listTitle">{vi.reminders.enableTitle}</AppText>
      <AppText variant="secondary">{vi.reminders.enableBody}</AppText>
      <View style={styles.row}>
        <Button
          label={vi.reminders.enable}
          onPress={() =>
            void requestPermission().then((p) => {
              setPerm(p);
              if (p === 'granted') void registerPushToken();
            })
          }
          style={styles.flex}
        />
        <Button label={vi.reminders.later} variant="ghost" onPress={dismiss} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 120 },
  // Wraps instead of squeezing labels when text is large or the screen is narrow.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
});
