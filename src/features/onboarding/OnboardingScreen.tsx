/**
 * /onboarding/[step] — first run (spec: ≤ 5 steps, optional ones marked).
 *   1 Đăng nhập (done before this screen) · 2 google · 3 office · 4 timetable · 5 notifications
 * Finishing stores profiles.onboarding_completed_at and creates the "Hướng dẫn nhanh" note.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { errorMessage } from '../../components/QueryState';
import { showToast } from '../../components/Toast';
import { useResponsive } from '../../hooks/useResponsive';
import { useSync } from '../../hooks/useSync';
import { vi } from '../../i18n/vi';
import { gcalStart } from '../../lib/api/functions';
import { newId, useCreateNote, useDeleteClassSession, useUpdateProfile, useUpsertWorkHours } from '../../lib/api/mutations';
import { qk, useCollections, useNotes, useSettings } from '../../lib/api/queries';
import { isDemo } from '../../lib/api/supabase';
import { getPermission, type PermissionState, requestPermission } from '../../lib/notifications/localAdapter';
import { hhmm, sortByWeekThenTime } from '../../lib/settings/hours';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';
import { useSession } from '../auth/session';
import { SessionForm } from '../settings/Timetable';
import { WorkHoursEditor } from '../settings/WorkHoursEditor';
import { QUICK_START_TITLE, quickStartDoc } from './quickStart';

export const STEPS = ['google', 'office', 'timetable', 'notifications'] as const;
type Step = (typeof STEPS)[number];
const TOTAL = STEPS.length + 1; // + sign-in

export function OnboardingScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const params = useLocalSearchParams<{ step?: string; gcal?: string }>();
  const step: Step = (STEPS as readonly string[]).includes(params.step ?? '') ? (params.step as Step) : 'google';
  const index = STEPS.indexOf(step);
  const settings = useSettings();
  const notes = useNotes().data ?? [];
  const updateProfile = useUpdateProfile();
  const createNote = useCreateNote();
  const [finishing, setFinishing] = useState(false);
  const optional = step !== 'office';

  const go = (s: Step) => router.replace({ pathname: '/onboarding/[step]', params: { step: s } });
  const next = () => (index < STEPS.length - 1 ? go(STEPS[index + 1]!) : void finish());
  const back = () => (index > 0 ? go(STEPS[index - 1]!) : undefined);

  const finish = async () => {
    setFinishing(true);
    let guideId = notes.find((n) => n.title === QUICK_START_TITLE)?.id ?? null;
    if (!guideId) {
      guideId = newId();
      const { doc, plain } = quickStartDoc();
      createNote.mutate({
        id: guideId,
        space: 'study',
        collection_id: null,
        title: QUICK_START_TITLE,
        content_json: doc,
        plain_text: plain,
        pinned: true,
      });
    }
    if (!settings.data?.profile?.onboarding_completed_at) updateProfile.mutate({ onboarding_completed_at: new Date().toISOString() });
    const id = guideId;
    router.replace('/');
    showToast(vi.onboarding.ready, {
      durationMs: 6000,
      action: { label: vi.onboarding.openGuide, onPress: () => router.push({ pathname: '/note/[id]', params: { id } }) },
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + spacing.md }]}>
      <ScrollView contentContainerStyle={[styles.content, mode !== 'phone' && styles.wide]} keyboardShouldPersistTaps="handled">
        <View style={styles.progressRow} accessibilityLabel={vi.onboarding.step(index + 2, TOTAL)}>
          {Array.from({ length: TOTAL }, (_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i <= index + 1 ? colors.primary : colors.surface2 }]} />
          ))}
        </View>
        <View style={styles.metaRow}>
          <AppText variant="meta" tone="muted">
            {vi.onboarding.step(index + 2, TOTAL)}
          </AppText>
          {optional && (
            <View style={[styles.tag, { backgroundColor: colors.surface2 }]}>
              <AppText variant="meta" tone="muted">
                {vi.onboarding.optional}
              </AppText>
            </View>
          )}
        </View>
        {step === 'google' && <GoogleStep gcal={params.gcal} />}
        {step === 'office' && <OfficeStep />}
        {step === 'timetable' && <TimetableStep />}
        {step === 'notifications' && <NotificationsStep />}
      </ScrollView>
      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.border, backgroundColor: colors.bg },
          mode !== 'phone' && styles.wide,
        ]}
      >
        {index > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={vi.onboarding.back} onPress={back} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textBody} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        {optional && index < STEPS.length - 1 && <Button label={vi.onboarding.skip} variant="ghost" onPress={next} />}
        <View style={styles.flex}>
          <Button label={index === STEPS.length - 1 ? vi.onboarding.finish : vi.onboarding.next} loading={finishing} onPress={next} />
        </View>
      </View>
    </View>
  );
}

function Title({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.titleBlock}>
      <AppText variant="screenTitle" accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant="body" tone="muted">
        {body}
      </AppText>
    </View>
  );
}

function GoogleStep({ gcal }: { gcal?: string }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const { conn, connected, syncNow } = useSync();
  const [busy, setBusy] = useState(false);
  const name =
    (session?.user.user_metadata?.full_name as string | undefined) ?? (session?.user.user_metadata?.name as string | undefined) ?? null;

  const handle = (status: string | null | undefined) => {
    if (!status) return;
    if (status === 'connected') {
      showToast(vi.google.connected);
      void qc.invalidateQueries({ queryKey: qk.google }).then(() => syncNow({ force: true }));
    } else if (status === 'cancelled') showToast(vi.google.cancelled);
    else showToast(vi.google.failed, { tone: 'error' });
  };
  useEffect(() => {
    handle(gcal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcal]);

  const connect = async () => {
    setBusy(true);
    try {
      const ret = Platform.OS === 'web' ? `${window.location.origin}/onboarding/google` : Linking.createURL('onboarding/google');
      const { url } = await gcalStart(ret);
      if (Platform.OS === 'web') {
        window.location.assign(url);
        return;
      }
      const res = await WebBrowser.openAuthSessionAsync(url, ret);
      if (res.type === 'success') handle(new URL(res.url).searchParams.get('gcal'));
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.titleBlock}>
        <AppText variant="section" tone="primary">
          {vi.onboarding.welcomeTitle(name)}
        </AppText>
        <AppText variant="body" tone="muted">
          {vi.onboarding.welcomeBody}
        </AppText>
      </View>
      <Title title={vi.onboarding.google.title} body={vi.onboarding.google.body} />
      <Card>
        {isDemo ? (
          <AppText variant="body" tone="muted">
            {vi.onboarding.google.demo}
          </AppText>
        ) : connected && conn?.google_email ? (
          <View style={styles.inline}>
            <Ionicons name="checkmark-circle" size={22} color="#3DD68C" />
            <AppText variant="body" tone="heading">
              {vi.onboarding.google.connected(conn.google_email)}
            </AppText>
          </View>
        ) : (
          <>
            <AppText variant="secondary" tone="warning">
              {vi.onboarding.google.warning}
            </AppText>
            <Button
              label={vi.onboarding.google.connect}
              icon={<Ionicons name="logo-google" size={16} color="#0E1116" />}
              loading={busy}
              onPress={() => void connect()}
            />
            <AppText variant="meta" tone="muted">
              {vi.onboarding.google.later}
            </AppText>
          </>
        )}
      </Card>
    </>
  );
}

function OfficeStep() {
  const settings = useSettings();
  const save = useUpsertWorkHours();
  return (
    <>
      <Title title={vi.onboarding.office.title} body={vi.onboarding.office.body} />
      {settings.data && <WorkHoursEditor rows={settings.data.workHours} onSave={(rows) => save.mutate(rows)} />}
    </>
  );
}

function TimetableStep() {
  const { colors } = useTheme();
  const settings = useSettings();
  const collections = useCollections().data ?? [];
  const del = useDeleteClassSession();
  const [formKey, setFormKey] = useState(0);
  const [nextDay, setNextDay] = useState(1);
  const sessions = sortByWeekThenTime(settings.data?.classSessions ?? []);
  return (
    <>
      <Title title={vi.onboarding.timetable.title} body={vi.onboarding.timetable.body} />
      {sessions.length > 0 && (
        <View style={styles.sessions}>
          {sessions.map((s) => (
            <View key={s.id} style={[styles.session, { backgroundColor: colors.studySoft, borderLeftColor: colors.study }]}>
              <AppText variant="body" tone="heading" style={styles.flex}>
                {vi.weekdaysShort[s.weekday]} · {collections.find((c) => c.id === s.collection_id)?.name ?? '—'} · {hhmm(s.start_time)}–
                {hhmm(s.end_time)}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={vi.common.delete}
                onPress={() => del.mutate(s.id)}
                style={styles.backBtn}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <AppText variant="secondary" tone="muted">
        {vi.onboarding.timetable.added(sessions.length)}
      </AppText>
      <Card>
        <SessionForm
          key={formKey}
          initial={null}
          sessions={sessions}
          collections={collections}
          submitLabel={vi.settingsPages.timetable.addSession}
          defaultWeekday={nextDay}
          onDone={(saved) => {
            // Next form starts on the following day, so it doesn't open on a clash.
            setNextDay((saved.weekday + 1) % 7);
            setFormKey((k) => k + 1);
          }}
        />
      </Card>
    </>
  );
}

function NotificationsStep() {
  const [perm, setPerm] = useState<PermissionState>('unsupported');
  useEffect(() => {
    void getPermission().then(setPerm);
  }, []);
  return (
    <>
      <Title title={vi.onboarding.notifications.title} body={vi.onboarding.notifications.body} />
      <Card>
        {Platform.OS === 'web' || perm === 'unsupported' ? (
          <AppText variant="secondary" tone="muted">
            {vi.onboarding.notifications.web}
          </AppText>
        ) : perm === 'granted' ? (
          <View style={styles.inline}>
            <Ionicons name="checkmark-circle" size={22} color="#3DD68C" />
            <AppText variant="body" tone="heading">
              {vi.onboarding.notifications.enabled}
            </AppText>
          </View>
        ) : perm === 'denied' ? (
          <AppText variant="secondary" tone="warning">
            {vi.onboarding.notifications.denied}
          </AppText>
        ) : (
          <Button
            label={vi.onboarding.notifications.enable}
            icon={<Ionicons name="notifications" size={16} color="#0E1116" />}
            onPress={() => void requestPermission().then(setPerm)}
          />
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  wide: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  progressRow: { flexDirection: 'row', gap: spacing.xs },
  dot: { flex: 1, height: 4, borderRadius: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.chip },
  titleBlock: { gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sessions: { gap: spacing.xs },
  session: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderRadius: radius.block, paddingLeft: spacing.md },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
