import { Alert, Platform } from 'react-native';
import { askConfirm } from '../components/ConfirmHost';
import { vi } from '../i18n/vi';

/** Destructive confirmation: native Alert on iOS, in-app dialog on web. */
export function confirmDestructive(message: string, confirmLabel: string = vi.common.delete): Promise<boolean> {
  if (Platform.OS === 'web') return askConfirm(message, confirmLabel);
  return new Promise((resolve) =>
    Alert.alert(message, undefined, [
      { text: vi.common.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
