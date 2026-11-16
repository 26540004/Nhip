/**
 * In-app confirmation dialog. Used on web instead of window.confirm (blocked in sandboxed
 * frames and unstyled); iOS keeps the native Alert.
 */
import { StyleSheet, View } from 'react-native';
import { create } from 'zustand';
import { vi } from '../i18n/vi';
import { spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface ConfirmState {
  message: string | null;
  confirmLabel: string;
  resolve: ((ok: boolean) => void) | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ message: null, confirmLabel: '', resolve: null }));

export function askConfirm(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().resolve?.(false);
    useConfirmStore.setState({ message, confirmLabel, resolve });
  });
}

export function ConfirmHost() {
  const { message, confirmLabel, resolve } = useConfirmStore();
  const done = (ok: boolean) => {
    resolve?.(ok);
    useConfirmStore.setState({ message: null, resolve: null });
  };
  return (
    <Sheet visible={message != null} onClose={() => done(false)} label={message ?? ''}>
      <AppText variant="listTitle">{message}</AppText>
      <View style={styles.row}>
        <Button label={vi.common.cancel} variant="secondary" onPress={() => done(false)} style={styles.flex} />
        <Button label={confirmLabel} variant="danger" onPress={() => done(true)} style={styles.flex} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
