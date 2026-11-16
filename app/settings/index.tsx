import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { HeaderIconButton } from '../../src/components/HeaderIconButton';
import { Screen } from '../../src/components/Screen';
import { signOut, useSession } from '../../src/features/auth/session';
import { vi } from '../../src/i18n/vi';
import { useUpdateProfile } from '../../src/lib/api/mutations';
import { useSettings } from '../../src/lib/api/queries';
import { queryClient } from '../../src/lib/api/queryClient';
import { isDemo } from '../../src/lib/api/supabase';
import { showToast } from '../../src/components/Toast';
import { useNow } from '../../src/hooks/useNow';
import { dateKeyOf } from '../../src/lib/time/tz';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing, touchTarget } from '../../src/theme/tokens';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { session } = useSession();
  const settings = useSettings();
  const now = useNow();
  const updateProfile = useUpdateProfile();
  const profile = settings.data?.profile;
  // The counter resets per local day (see consume_ai_call).
  const aiCalls = profile && profile.daily_ai_calls_date === dateKeyOf(now, profile.timezone) ? profile.daily_ai_calls : 0;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen title={vi.tabs.settings} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <Card>
        <AppText variant="meta" tone="muted">
          {vi.settings.account.toUpperCase()}
        </AppText>
        <AppText variant="body">{vi.settings.signedInAs(session?.user.email ?? '—')}</AppText>
      </Card>

      <Card>
        <AppText variant="meta" tone="muted">
          AI
        </AppText>
        <View style={styles.row}>
          <AppText variant="body" tone="heading" style={styles.flex}>
            {vi.settings.privacy}
          </AppText>
          <Switch
            accessibilityLabel={vi.settings.privacy}
            value={profile?.ai_privacy_mode ?? false}
            disabled={!profile}
            onValueChange={(v) => updateProfile.mutate({ ai_privacy_mode: v })}
            trackColor={{ true: colors.primary, false: colors.surface2 }}
            thumbColor={colors.textHeading}
            {...({ activeThumbColor: colors.textHeading } as object)}
          />
        </View>
        <AppText variant="secondary" tone="muted">
          {vi.settings.privacyHelp}
        </AppText>
        <AppText variant="secondary" numeric>
          {vi.settings.aiUsage(aiCalls)}
        </AppText>
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.google.title}
        onPress={() => router.push('/settings/google')}
        style={[styles.link, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name="logo-google" size={20} color={colors.textBody} />
        <AppText variant="body" tone="heading" style={styles.flex}>
          {vi.google.title}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.reminders.title}
        onPress={() => router.push('/settings/reminders')}
        style={[styles.link, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name="notifications-outline" size={20} color={colors.textBody} />
        <AppText variant="body" tone="heading" style={styles.flex}>
          {vi.reminders.title}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.collections.title}
        onPress={() => router.push('/settings/collections')}
        style={[styles.link, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name="folder-outline" size={20} color={colors.textBody} />
        <AppText variant="body" tone="heading" style={styles.flex}>
          {vi.collections.title}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>

      <AppText variant="secondary" tone="muted">
        {vi.settings.moreLater}
      </AppText>

      {isDemo ? (
        <Button
          label={vi.demo.reset}
          variant="secondary"
          onPress={() =>
            void signOut().then(() => {
              void queryClient.invalidateQueries();
              showToast(vi.demo.resetDone);
            })
          }
        />
      ) : (
        <Button label={vi.auth.signOut} variant="secondary" onPress={() => void signOut()} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget + 12,
  },
});
