/**
 * Settings → Google Calendar: connect / disconnect, pick calendars to READ for busy times,
 * target calendar (the app's own "Nhịp" calendar), last sync, "Đồng bộ ngay".
 * Handles the OAuth return (?gcal=connected|cancelled|error).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { HeaderIconButton } from '../../src/components/HeaderIconButton';
import { errorMessage } from '../../src/components/QueryState';
import { Screen } from '../../src/components/Screen';
import { showToast } from '../../src/components/Toast';
import { useSync } from '../../src/hooks/useSync';
import { vi } from '../../src/i18n/vi';
import { confirmDestructive } from '../../src/lib/confirm';
import { gcalCalendars, gcalDisconnect, gcalStart } from '../../src/lib/api/functions';
import { qk } from '../../src/lib/api/queries';
import { currentUserId, isDemo, requireSupabase, unwrap } from '../../src/lib/api/supabase';
import { formatDayHeader } from '../../src/lib/time/format';
import { dateKeyOf, hhmmOf } from '../../src/lib/time/tz';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing, touchTarget } from '../../src/theme/tokens';

function returnUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/settings/google`;
  return Linking.createURL('settings/google');
}

export default function GoogleSettings() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ gcal?: string }>();
  const { conn, connected, state, syncNow } = useSync();
  const [busy, setBusy] = useState(false);
  const calendars = useQuery({ queryKey: ['gcalCalendars'], queryFn: gcalCalendars, enabled: connected, staleTime: 5 * 60_000 });

  const handleReturn = (status: string | undefined) => {
    if (!status) return;
    if (status === 'connected') {
      showToast(vi.google.connected);
      void qc.invalidateQueries({ queryKey: qk.google }).then(() => syncNow({ force: true }));
    } else if (status === 'cancelled') showToast(vi.google.cancelled);
    else showToast(vi.google.failed, { tone: 'error' });
  };

  useEffect(() => {
    handleReturn(params.gcal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.gcal]);

  const connect = async () => {
    setBusy(true);
    try {
      const ret = returnUrl();
      const { url } = await gcalStart(ret);
      if (Platform.OS === 'web') {
        window.location.assign(url);
        return;
      }
      const res = await WebBrowser.openAuthSessionAsync(url, ret);
      if (res.type === 'success') handleReturn(new URL(res.url).searchParams.get('gcal') ?? undefined);
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!(await confirmDestructive(vi.google.confirmDisconnect, vi.google.disconnect))) return;
    try {
      await gcalDisconnect();
      await qc.invalidateQueries();
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    }
  };

  const toggleRead = async (id: string) => {
    if (!conn) return;
    const next = conn.read_calendar_ids.includes(id) ? conn.read_calendar_ids.filter((x) => x !== id) : [...conn.read_calendar_ids, id];
    try {
      unwrap(
        await requireSupabase()
          .from('google_connections')
          .update({ read_calendar_ids: next })
          .eq('user_id', await currentUserId())
          .select('user_id'),
      );
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    }
    await qc.invalidateQueries({ queryKey: qk.google });
    void syncNow({ force: true });
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  const lastSync = conn?.last_synced_at ? Date.parse(conn.last_synced_at) : null;
  const needsReconnect = conn?.status === 'revoked';

  return (
    <Screen title={vi.google.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <Card>
        <AppText variant="secondary" tone="muted">
          {vi.google.why}
        </AppText>
        {isDemo ? (
          <AppText variant="body" tone="muted">
            {vi.onboarding.google.demo}
          </AppText>
        ) : !connected || needsReconnect ? (
          <>
            {needsReconnect && (
              <AppText variant="secondary" tone="danger">
                {vi.google.revoked}
              </AppText>
            )}
            <AppText variant="meta" tone="muted">
              {vi.google.unverified}
            </AppText>
            <Button
              label={needsReconnect ? vi.google.reconnect : vi.google.connect}
              icon={<Ionicons name="logo-google" size={16} color="#0E1116" />}
              loading={busy}
              onPress={() => void connect()}
            />
          </>
        ) : (
          <>
            <AppText variant="body" tone="heading">
              {vi.google.connectedAs(conn?.google_email ?? '—')}
            </AppText>
            <AppText variant="secondary" tone={conn?.status === 'error' ? 'danger' : 'muted'} numeric>
              {conn?.status === 'error' && conn.last_error
                ? conn.last_error
                : lastSync
                  ? vi.google.lastSync(`${formatDayHeader(dateKeyOf(lastSync))} ${hhmmOf(lastSync)}`)
                  : vi.google.never}
            </AppText>
            <View style={styles.row}>
              <Button
                label={state === 'syncing' ? vi.google.syncing : vi.google.syncNow}
                variant="secondary"
                loading={state === 'syncing'}
                onPress={() => void syncNow({ force: true })}
                style={styles.flex}
              />
              <Button label={vi.google.disconnect} variant="ghost" onPress={() => void disconnect()} />
            </View>
          </>
        )}
      </Card>

      {connected && !needsReconnect && (
        <>
          <Card>
            <AppText variant="meta" tone="muted">
              {vi.google.target.toUpperCase()}
            </AppText>
            <View style={styles.row}>
              <Ionicons name="calendar" size={18} color={colors.primary} />
              <AppText variant="body" tone="heading">
                {vi.google.targetName}
              </AppText>
            </View>
          </Card>
          <Card>
            <AppText variant="meta" tone="muted">
              {vi.google.readCalendars.toUpperCase()}
            </AppText>
            {calendars.isLoading && (
              <AppText variant="secondary" tone="muted">
                {vi.states.loading}
              </AppText>
            )}
            {(calendars.data?.calendars ?? [])
              .filter((c) => !c.is_target)
              .map((c) => {
                const on = conn?.read_calendar_ids.includes(c.id) || (c.primary && conn?.read_calendar_ids.includes('primary'));
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!on }}
                    accessibilityLabel={c.summary}
                    onPress={() => void toggleRead(c.primary && conn?.read_calendar_ids.includes('primary') ? 'primary' : c.id)}
                    style={styles.calRow}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textMuted} />
                    <View style={[styles.dot, { backgroundColor: c.color ?? colors.external }]} />
                    <AppText variant="body" tone="heading" style={styles.flex} numberOfLines={1}>
                      {c.summary}
                    </AppText>
                  </Pressable>
                );
              })}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
