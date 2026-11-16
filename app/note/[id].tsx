import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteEditor } from '../../src/features/notes/NoteEditor';
import { vi } from '../../src/i18n/vi';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing, touchTarget } from '../../src/theme/tokens';

export default function NoteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/notes'));
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}
    >
      <View>
        <Pressable accessibilityRole="button" accessibilityLabel={vi.common.back} onPress={close} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.textHeading} />
        </Pressable>
      </View>
      <NoteEditor noteId={id} onClose={close} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
});
