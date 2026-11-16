import { router } from 'expo-router';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { Screen } from '../../src/components/Screen';
import { vi } from '../../src/i18n/vi';

export default function SettingsScreen() {
  return (
    <Screen title={vi.tabs.settings}>
      <EmptyState icon="settings-outline" title={vi.comingSoon.title} body={vi.comingSoon.body} />
      <Button label={vi.common.close} variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}
