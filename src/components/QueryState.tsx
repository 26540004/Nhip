import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useOnline } from '../hooks/useOnline';
import { vi } from '../i18n/vi';
import { ApiError } from '../lib/api/supabase';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return vi.errors[e.code] ?? vi.errors.internal!;
  return vi.errors.internal!;
}

/**
 * Loading / error / offline wrapper for a query. Shows cached data when available, with a
 * thin offline note, and only blocks the screen when there is nothing to show.
 */
export function QueryState({
  isLoading,
  error,
  hasData,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const online = useOnline();
  if (hasData) {
    return (
      <>
        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.surface2 }]} accessibilityRole="alert">
            <AppText variant="meta" tone="muted">
              {vi.states.offline}
            </AppText>
          </View>
        )}
        {children}
      </>
    );
  }
  if (isLoading) {
    return (
      <View style={styles.center} accessibilityLabel={vi.states.loading}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="secondary" tone="muted">
          {vi.states.loading}
        </AppText>
      </View>
    );
  }
  if (!online)
    return <EmptyState icon="cloud-offline-outline" title={vi.errors.offline!} actionLabel={vi.states.retry} onAction={onRetry} />;
  if (error) {
    return (
      <View style={styles.center}>
        <AppText variant="body" tone="danger" style={styles.text}>
          {errorMessage(error)}
        </AppText>
        <Button label={vi.states.retry} variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  text: { textAlign: 'center' },
  banner: { borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
});
