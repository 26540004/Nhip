import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../hooks/useResponsive';
import { vi } from '../i18n/vi';
import { useUiStore } from '../stores/ui';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  index: { label: vi.tabs.today, icon: 'sunny-outline', iconActive: 'sunny' },
  tasks: { label: vi.tabs.tasks, icon: 'checkbox-outline', iconActive: 'checkbox' },
  notes: { label: vi.tabs.notes, icon: 'document-text-outline', iconActive: 'document-text' },
  calendar: { label: vi.tabs.calendar, icon: 'calendar-outline', iconActive: 'calendar' },
};

/**
 * Phone: bottom bar with 5 slots (Hôm nay · Việc · ＋ · Ghi chú · Lịch); ＋ opens Quick Add (not a route).
 * Desktop (≥ 1024): left sidebar with the same sections + Cài đặt.
 */
export function AppTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const openQuickAdd = useUiStore((s) => s.setQuickAddOpen);

  const items = state.routes
    .filter((r) => TABS[r.name])
    .map((route) => {
      const index = state.routes.findIndex((r) => r.key === route.key);
      const focused = state.index === index;
      const meta = TABS[route.name]!;
      const onPress = () => {
        if (!focused) navigateToTab(route.key);
      };
      return { key: route.key, focused, meta, onPress };
    });

  if (mode === 'desktop') {
    return (
      <View
        style={[styles.sidebar, { backgroundColor: colors.surface, borderRightColor: colors.border, paddingTop: insets.top + spacing.xl }]}
      >
        <AppText variant="section" style={styles.brand}>
          {vi.appName}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${vi.tabs.add} (N)`}
          onPress={() => openQuickAdd(true)}
          style={[styles.sideAdd, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="add" size={20} color="#0E1116" />
          <AppText variant="body" style={{ color: '#0E1116', fontFamily: 'Inter_600SemiBold' }}>
            {vi.tabs.add}
          </AppText>
        </Pressable>
        {items.map((it) => (
          <SideItem key={it.key} role="tab" selected={it.focused} label={it.meta.label} onPress={it.onPress}>
            <Ionicons
              name={it.focused ? it.meta.iconActive : it.meta.icon}
              size={20}
              color={it.focused ? colors.primary : colors.textMuted}
            />
            <AppText variant="body" tone={it.focused ? 'heading' : 'muted'}>
              {it.meta.label}
            </AppText>
          </SideItem>
        ))}
        <View style={styles.flex} />
        <SideItem role="button" label={vi.tabs.settings} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
          <AppText variant="body" tone="muted">
            {vi.tabs.settings}
          </AppText>
        </SideItem>
      </View>
    );
  }

  const left = items.slice(0, 2);
  const right = items.slice(2);
  const renderTab = (it: (typeof items)[number]) => (
    <Pressable
      key={it.key}
      accessibilityRole="tab"
      accessibilityState={{ selected: it.focused }}
      accessibilityLabel={it.meta.label}
      onPress={it.onPress}
      style={styles.tab}
    >
      <Ionicons
        name={it.focused ? it.meta.iconActive : it.meta.icon}
        size={22}
        color={it.focused ? colors.textHeading : colors.textMuted}
      />
      <AppText variant="meta" tone={it.focused ? 'heading' : 'muted'} maxFontSizeMultiplier={1.3}>
        {it.meta.label}
      </AppText>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      {left.map(renderTab)}
      <View style={styles.tab}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={vi.tabs.add}
          onPress={() => openQuickAdd(true)}
          style={({ pressed }) => [styles.plus, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="add" size={28} color="#0E1116" />
        </Pressable>
      </View>
      {right.map(renderTab)}
    </View>
  );
}

/** Sidebar row with web hover state. */
function SideItem({
  children,
  role,
  selected = false,
  label,
  onPress,
}: {
  children: ReactNode;
  role: 'tab' | 'button';
  selected?: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.sideItem, (selected || hovered) && { backgroundColor: selected ? colors.primarySoft : colors.surface2 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: touchTarget, gap: 2 },
  plus: { width: 52, height: 40, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  sidebar: { width: 240, borderRightWidth: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  brand: { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  sideAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  sideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
  },
});
