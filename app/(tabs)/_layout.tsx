import { Tabs } from 'expo-router/js-tabs';
import { AppTabBar } from '../../src/components/AppTabBar';
import { useResponsive } from '../../src/hooks/useResponsive';
import { vi } from '../../src/i18n/vi';

export default function TabsLayout() {
  const { mode } = useResponsive();
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarPosition: mode === 'desktop' ? 'left' : 'bottom' }}
    >
      <Tabs.Screen name="index" options={{ title: vi.tabs.today }} />
      <Tabs.Screen name="tasks" options={{ title: vi.tabs.tasks }} />
      <Tabs.Screen name="notes" options={{ title: vi.tabs.notes }} />
      <Tabs.Screen name="calendar" options={{ title: vi.tabs.calendar }} />
    </Tabs>
  );
}
