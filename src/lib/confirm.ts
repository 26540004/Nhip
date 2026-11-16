import { Alert, Platform } from 'react-native';
import { vi } from '../i18n/vi';

/** Destructive confirmation that works on iOS and web. */
export function confirmDestructive(message: string, confirmLabel: string = vi.common.delete): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
  }
  return new Promise((resolve) =>
    Alert.alert(message, undefined, [
      { text: vi.common.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
