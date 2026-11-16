import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  /** Light haptic on press (iOS). */
  haptic?: boolean;
}

export function Button({ label, variant = 'primary', icon, loading, disabled, haptic = true, onPress, style, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const bg: Record<ButtonVariant, string> = {
    primary: colors.primary,
    ai: colors.primary,
    secondary: colors.surface2,
    ghost: 'transparent',
    danger: colors.danger,
  };
  const fg = variant === 'secondary' || variant === 'ghost' ? colors.textHeading : '#0E1116';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={(e) => {
        if (haptic && Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={(state) => [
        styles.base,
        { backgroundColor: bg[variant], opacity: isDisabled ? 0.5 : state.pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        // The single allowed glow: the primary "✦ AI xếp lịch" action.
        variant === 'ai' && styles.aiGlow,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <AppText variant="body" style={{ color: fg, fontFamily: 'Inter_600SemiBold' }}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aiGlow: {
    shadowColor: '#8B7CFF',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
