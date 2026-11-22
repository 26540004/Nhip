/** Cài đặt → Dữ liệu: export everything as a .zip, clear the local cache, sign out. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatBytes } from '../../../supabase/functions/_shared/audio-retention.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { errorMessage } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { showToast } from '../../components/Toast';
import { useOnline } from '../../hooks/useOnline';
import { vi } from '../../i18n/vi';
import { storageUsage } from '../../lib/api/functions';
import { queryClient, queryPersister } from '../../lib/api/queryClient';
import { isDemo } from '../../lib/api/supabase';
import { exportAll } from '../../lib/export/exportData';
import { useTheme } from '../../theme/ThemeProvider';
import { signOut } from '../auth/session';

const FREE_STORAGE = 1024 ** 3; // Supabase Free: 1 GB of files

/** "Dung lượng đã dùng": files in Storage (audio, images), against the free 1 GB. */
function StorageCard() {
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ['storage-usage'], queryFn: storageUsage, staleTime: 60_000 });
  const u = q.data;
  const used = u ? u.audio + u.image + u.other : 0;
  const pct = Math.min(1, used / FREE_STORAGE);
  return (
    <Card>
      <AppText variant="section">{vi.audioRetention.usageTitle}</AppText>
      {u ? (
        <>
          <AppText variant="body" tone="heading" numeric>
            {vi.audioRetention.usage(formatBytes(used), '1 GB')}
          </AppText>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={vi.audioRetention.usageTitle}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
            style={[styles.rail, { backgroundColor: colors.surface2 }]}
          >
            <View
              style={[
                styles.fill,
                { width: `${Math.max(pct * 100, used > 0 ? 1 : 0)}%`, backgroundColor: pct >= 0.8 ? colors.warning : colors.primary },
              ]}
            />
          </View>
          <AppText variant="meta" tone="muted" numeric>
            {vi.audioRetention.usageParts(formatBytes(u.audio), formatBytes(u.image + u.other))}
          </AppText>
          {pct >= 0.8 && (
            <AppText variant="secondary" tone="warning">
              {vi.audioRetention.usageNear}
            </AppText>
          )}
        </>
      ) : (
        <AppText variant="secondary" tone="muted">
          {q.isError ? vi.audioRetention.usageError : vi.states.loading}
        </AppText>
      )}
      <AppText variant="meta" tone="muted">
        {vi.audioRetention.usageHelp}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  rail: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});

export function DataScreen() {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const run = async () => {
    setBusy(true);
    try {
      const n = await exportAll();
      showToast(vi.settingsPages.data.exported(n));
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const clearCache = async () => {
    await queryPersister.removeClient();
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    await queryClient.invalidateQueries();
    showToast(vi.settingsPages.data.cleared);
  };

  return (
    <Screen title={vi.settingsPages.data.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <StorageCard />
      <Card>
        <AppText variant="section">{vi.settingsPages.data.exportTitle}</AppText>
        <AppText variant="secondary" tone="muted">
          {vi.settingsPages.data.exportHelp}
        </AppText>
        {!online && !isDemo ? (
          <AppText variant="secondary" tone="warning">
            {vi.settingsPages.data.offline}
          </AppText>
        ) : null}
        <Button
          label={busy ? vi.settingsPages.data.exporting : vi.settingsPages.data.export}
          icon={<Ionicons name="download-outline" size={18} color="#0E1116" />}
          loading={busy}
          disabled={!online && !isDemo}
          onPress={() => void run()}
        />
      </Card>
      <Card>
        <AppText variant="body" tone="heading">
          {vi.settingsPages.data.clearLocal}
        </AppText>
        <AppText variant="secondary" tone="muted">
          {vi.settingsPages.data.clearLocalHelp}
        </AppText>
        <Button label={vi.settingsPages.data.clearLocal} variant="secondary" onPress={() => void clearCache()} />
      </Card>
      {!isDemo && (
        <Card>
          <AppText variant="secondary" tone="muted">
            {vi.settingsPages.data.signOutHelp}
          </AppText>
          <Button label={vi.auth.signOut} variant="secondary" onPress={() => void signOut()} />
        </Card>
      )}
    </Screen>
  );
}
