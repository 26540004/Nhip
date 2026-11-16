import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../hooks/useResponsive';
import { vi } from '../i18n/vi';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

/**
 * Bottom sheet (phone) / centered dialog (desktop). Keyboard-aware. Esc closes on web
 * (handled by the global shortcut hook). Slide-up uses the native modal animation, which
 * respects the system reduced-motion setting.
 */
export function Sheet({ visible, onClose, children, label }: { visible: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const centered = mode !== 'phone';

  return (
    <Modal visible={visible} transparent animationType={centered ? 'fade' : 'slide'} onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable accessibilityLabel={vi.common.close} style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, centered && styles.centeredContainer]}
        pointerEvents="box-none"
      >
        <View
          accessibilityLabel={label}
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.lg) },
            centered && styles.dialog,
          ]}
        >
          {!centered && <View style={[styles.grabber, { backgroundColor: colors.border }]} />}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  container: { flex: 1, justifyContent: 'flex-end' },
  centeredContainer: { justifyContent: 'center', alignItems: 'center' },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dialog: { width: 560, maxWidth: '92%', borderRadius: radius.sheet, paddingBottom: spacing.lg },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: spacing.xs },
});
