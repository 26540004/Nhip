/** Cài đặt → Dữ liệu: export everything as a .zip, clear the local cache, sign out. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { errorMessage } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { showToast } from '../../components/Toast';
import { useOnline } from '../../hooks/useOnline';
import { vi } from '../../i18n/vi';
import { queryClient, queryPersister } from '../../lib/api/queryClient';
import { isDemo } from '../../lib/api/supabase';
import { exportAll } from '../../lib/export/exportData';
import { signOut } from '../auth/session';

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
