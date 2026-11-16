import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';

interface ToastState {
  message: string | null;
  tone: 'info' | 'error';
  action?: { label: string; onPress: () => void };
  durationMs: number;
  id: number;
}

const useToastStore = create<ToastState>(() => ({ message: null, tone: 'info', durationMs: 3000, id: 0 }));

export function showToast(message: string, opts: { tone?: 'info' | 'error'; action?: ToastState['action']; durationMs?: number } = {}) {
  useToastStore.setState((s) => ({
    message,
    tone: opts.tone ?? 'info',
    action: opts.action,
    durationMs: opts.durationMs ?? 3000,
    id: s.id + 1,
  }));
}

export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { message, tone, action, durationMs, id } = useToastStore();

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => useToastStore.setState({ message: null }), durationMs);
    return () => clearTimeout(t);
  }, [id, message, durationMs]);

  if (!message) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 88 }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.toast, { backgroundColor: colors.surface2, borderColor: tone === 'error' ? colors.danger : colors.border }]}
      >
        <AppText variant="secondary" tone={tone === 'error' ? 'danger' : 'heading'} style={styles.flex}>
          {message}
        </AppText>
        {action && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              action.onPress();
              useToastStore.setState({ message: null });
            }}
            hitSlop={8}
          >
            <AppText variant="secondary" tone="primary" style={{ fontFamily: 'Inter_600SemiBold' }}>
              {action.label}
            </AppText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    maxWidth: 520,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
