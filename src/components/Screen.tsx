import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { AppText } from './AppText';

/** Standard screen: safe areas, 16px gutters, title row, scrollable content. */
export function Screen({
  title,
  right,
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  footer,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  /** Pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Floating content above the scroll view (e.g. the AI button). */
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const body = <View style={styles.content}>{children}</View>;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.header, mode === 'desktop' && styles.wide]}>
        <AppText variant="screenTitle" accessibilityRole="header">
          {title}
        </AppText>
        {right}
      </View>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, mode === 'desktop' && styles.wide]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.flex, mode === 'desktop' && styles.wide]}>{body}</View>
      )}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scroll: { paddingBottom: 120 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  wide: { width: '100%', maxWidth: 960, alignSelf: 'center' },
});
