import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TaskDetail } from '../../src/features/tasks/TaskDetail';
import { vi } from '../../src/i18n/vi';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing, touchTarget } from '../../src/theme/tokens';

export default function TaskRoute() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/tasks'));
  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={vi.common.back} onPress={close} style={styles.back}>
        <Ionicons name="chevron-back" size={26} color={colors.textHeading} />
      </Pressable>
      <TaskDetail taskId={id} initialTitle={title} onClose={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
});
