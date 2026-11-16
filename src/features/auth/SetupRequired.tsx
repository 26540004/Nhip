import { EmptyState } from '../../components/EmptyState';
import { Screen } from '../../components/Screen';
import { vi } from '../../i18n/vi';

/** Shown when the build has no Supabase env vars. */
export function SetupRequired() {
  return (
    <Screen title={vi.appName}>
      <EmptyState icon="construct-outline" title={vi.auth.notConfigured} body={vi.auth.notConfiguredBody} />
    </Screen>
  );
}
