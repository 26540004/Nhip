/** Cài đặt: grouped rows with a one-line summary each, AI privacy, data, account. */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { Screen } from '../../components/Screen';
import { SettingsRow } from '../../components/SettingsRow';
import { showToast } from '../../components/Toast';
import { useNow } from '../../hooks/useNow';
import { vi } from '../../i18n/vi';
import { useHabits } from '../../lib/api/habits';
import { useUpdateProfile } from '../../lib/api/mutations';
import { useCollections, useGoogleConnection, useSettings } from '../../lib/api/queries';
import { queryClient } from '../../lib/api/queryClient';
import { isDemo } from '../../lib/api/supabase';
import { hhmm, summarizeCapacity, summarizeWindows, summarizeWorkHours } from '../../lib/settings/hours';
import { formatDurationCompact } from '../../lib/time/format';
import { dateKeyOf } from '../../lib/time/tz';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';
import { signOut, useSession } from '../auth/session';

export function SettingsScreen() {
  const { colors } = useTheme();
  const { session } = useSession();
  const settings = useSettings();
  const google = useGoogleConnection().data;
  const collections = useCollections().data ?? [];
  const now = useNow();
  const updateProfile = useUpdateProfile();
  const habits = useHabits().data;
  const s = settings.data;
  const profile = s?.profile;
  // The counter resets per local day (see consume_ai_call).
  const aiCalls = profile && profile.daily_ai_calls_date === dateKeyOf(now, profile.timezone) ? profile.daily_ai_calls : 0;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const email = session?.user.email ?? '—';
  const name = profile?.display_name || email.split('@')[0] || '';
  const active = collections.filter((c) => !c.archived);
  const r = s?.reminders;

  return (
    <Screen title={vi.tabs.settings} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <Card>
        <View style={styles.account}>
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <AppText variant="section" tone="primary">
              {(name[0] ?? '?').toUpperCase()}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="body" tone="heading">
              {name}
            </AppText>
            <AppText variant="secondary" tone="muted" numberOfLines={1}>
              {vi.settings.signedInAs(email)}
            </AppText>
          </View>
        </View>
      </Card>

      <Section title={vi.settings.sections.schedule}>
        <SettingsRow
          icon="logo-google"
          title={vi.google.title}
          summary={
            isDemo
              ? vi.onboarding.google.demo
              : google?.status === 'revoked'
                ? vi.google.revoked
                : google?.google_email && google.status !== 'disconnected'
                  ? vi.google.connectedAs(google.google_email)
                  : vi.google.notConnected
          }
          tone={google?.status === 'revoked' || google?.status === 'error' ? 'warning' : undefined}
          onPress={() => router.push('/settings/google')}
        />
        <SettingsRow
          icon="briefcase-outline"
          title={vi.settingsPages.workHours.title}
          summary={s ? summarizeWorkHours(s.workHours) : null}
          onPress={() => router.push('/settings/work-hours')}
        />
        <SettingsRow
          icon="school-outline"
          title={vi.settingsPages.timetable.title}
          summary={s ? vi.settingsPages.timetableSummary(s.classSessions.length, s.exceptions.length) : null}
          onPress={() => router.push('/settings/timetable')}
        />
        <SettingsRow
          icon="book-outline"
          title={vi.settingsPages.studyWindows.title}
          summary={s ? summarizeWindows(s.studyWindows) : null}
          onPress={() => router.push('/settings/study-windows')}
        />
        <SettingsRow
          icon="speedometer-outline"
          title={vi.settingsPages.capacity.title}
          summary={
            s
              ? vi.settingsPages.capacity.perWeek(
                  formatDurationCompact(summarizeCapacity(s.capacity, 'study')),
                  formatDurationCompact(summarizeCapacity(s.capacity, 'work')),
                )
              : null
          }
          onPress={() => router.push('/settings/capacity')}
        />
      </Section>

      <Section title={vi.settings.sections.app}>
        <SettingsRow
          icon="notifications-outline"
          title={vi.reminders.title}
          summary={
            r
              ? vi.settingsPages.remindersSummary(
                  r.morning_brief_enabled ? hhmm(r.morning_brief_time) : null,
                  r.evening_review_enabled ? hhmm(r.evening_review_time) : null,
                )
              : null
          }
          onPress={() => router.push('/settings/reminders')}
        />
        <SettingsRow
          icon="folder-outline"
          title={vi.collections.title}
          summary={vi.settingsPages.collectionsSummary(
            active.filter((c) => c.space === 'study').length,
            active.filter((c) => c.space === 'work').length,
          )}
          onPress={() => router.push('/settings/collections')}
        />
        <SettingsRow
          icon="sparkles-outline"
          title={vi.habits.title}
          summary={habits ? vi.habits.rowSummary(habits.profile.completedSample, habits.vocab.length) : null}
          onPress={() => router.push('/settings/habits')}
        />
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
          <AppText variant="secondary" tone="muted">
            {vi.settings.providers}
          </AppText>
          <AppText variant="secondary" numeric>
            {vi.settings.aiUsage(aiCalls)}
          </AppText>
        </Card>
      </Section>

      <Section title={vi.settings.sections.data}>
        <SettingsRow
          icon="download-outline"
          title={vi.settingsPages.data.title}
          summary={vi.settingsPages.data.exportTitle}
          onPress={() => router.push('/settings/data')}
        />
        <SettingsRow
          icon="sparkles-outline"
          title={vi.settings.replayOnboarding}
          onPress={() => router.push({ pathname: '/onboarding/[step]', params: { step: 'google' } })}
        />
      </Section>

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
      <AppText variant="meta" tone="muted" style={styles.center}>
        {vi.settings.version(Constants.expoConfig?.version ?? '')}
      </AppText>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="meta" tone="muted" accessibilityRole="header">
        {title.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: spacing.sm },
  account: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  center: { textAlign: 'center' },
});
