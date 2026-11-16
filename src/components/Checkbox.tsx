import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { touchTarget } from '../theme/tokens';

/** Round checkbox: fills on check with a light haptic (spec §E Motion). */
export function Checkbox({
  checked,
  onChange,
  label,
  color,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  color?: string;
}) {
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(!checked);
      }}
      style={styles.target}
    >
      <View style={[styles.box, { borderColor: checked ? tint : colors.textMuted, backgroundColor: checked ? tint : 'transparent' }]}>
        {checked && <Ionicons name="checkmark" size={14} color="#0E1116" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
