import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { EmptyState } from '../src/components/EmptyState';
import { Screen } from '../src/components/Screen';
import { vi } from '../src/i18n/vi';

export default function NotFound() {
  return (
    <Screen title={vi.appName}>
      <EmptyState icon="help-circle-outline" title={vi.common.notFound} />
      <Button label={vi.tabs.today} onPress={() => router.replace('/')} />
    </Screen>
  );
}
