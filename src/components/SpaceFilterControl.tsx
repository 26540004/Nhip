import { Pressable, StyleSheet, View } from 'react-native';
import { vi } from '../i18n/vi';
import { type FilterScreen, type SpaceFilter, useUiStore } from '../stores/ui';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

const OPTIONS: SpaceFilter[] = ['all', 'study', 'work'];

/** "Tất cả | Học | Việc" — remembered per screen. */
export function SpaceFilterControl({ screen }: { screen: FilterScreen }) {
  const { colors } = useTheme();
  const value = useUiStore((s) => s.spaceFilter[screen]);
  const set = useUiStore((s) => s.setSpaceFilter);

  return (
    <View accessibilityRole="tablist" style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {OPTIONS.map((opt) => {
        const selected = opt === value;
        const dot = opt === 'study' ? colors.study : opt === 'work' ? colors.work : null;
        return (
          <Pressable
            key={opt}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={vi.spaceFilter[opt]}
            onPress={() => set(screen, opt)}
            style={[styles.seg, selected && { backgroundColor: colors.surface2 }]}
          >
            {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
            <AppText variant="secondary" tone={selected ? 'heading' : 'muted'}>
              {vi.spaceFilter[opt]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: radius.input, borderWidth: 1, padding: 2 },
  seg: {
    flex: 1,
    minHeight: touchTarget - 4,
    borderRadius: radius.input - 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
