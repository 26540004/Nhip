import { EmptyState } from '../../src/components/EmptyState';
import { Screen } from '../../src/components/Screen';
import { SpaceFilterControl } from '../../src/components/SpaceFilterControl';
import { vi } from '../../src/i18n/vi';

/** Phase 1 shell: navigation, space filter and empty state. Data arrives in Phase 2. */
export default function Screen_calendar() {
  return (
    <Screen title={vi.tabs.calendar}>
      <SpaceFilterControl screen="calendar" />
      <EmptyState icon="calendar-outline" title={vi.comingSoon.title} body={vi.comingSoon.body} />
    </Screen>
  );
}
