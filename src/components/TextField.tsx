import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { type as typeScale } from '../theme/typography';
import { AppText } from './AppText';

export function TextField({
  label,
  hint,
  error,
  style,
  multiline,
  ...rest
}: TextInputProps & { label?: string; hint?: string; error?: string | null }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label && (
        <AppText variant="meta" tone="muted">
          {label}
        </AppText>
      )}
      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        accessibilityLabel={label ?? rest.placeholder}
        multiline={multiline}
        style={[
          typeScale.body,
          styles.input,
          {
            color: colors.textHeading,
            backgroundColor: colors.surface2,
            borderColor: error ? colors.danger : focused ? colors.primary : colors.border,
          },
          multiline && styles.multiline,
          style,
        ]}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
      />
      {error ? (
        <AppText variant="meta" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="meta" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  input: {
    outlineWidth: 0,
    minHeight: touchTarget,
    borderRadius: radius.input,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
