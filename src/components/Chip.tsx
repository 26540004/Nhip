import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';

type IconName = ComponentProps<typeof Ionicons>['name'];
export type ChipTone = 'neutral' | 'study' | 'work' | 'primary' | 'warning' | 'danger';

/** Pill chip. Tappable when `onPress` is set. `highlight` draws a warning outline (e.g. "check space"). */
export function Chip({
  label,
  icon,
  tone = 'neutral',
  selected,
  highlight,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  tone?: ChipTone;
  selected?: boolean;
  highlight?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const map: Record<ChipTone, { fg: string; bg: string }> = {
    neutral: { fg: colors.textBody, bg: colors.surface2 },
    study: { fg: colors.study, bg: colors.studySoft },
    work: { fg: colors.work, bg: colors.workSoft },
    primary: { fg: colors.primary, bg: colors.primarySoft },
    warning: { fg: colors.warning, bg: 'rgba(245,196,81,0.14)' },
    danger: { fg: colors.danger, bg: 'rgba(255,107,107,0.14)' },
  };
  const c = map[tone];
  const body = (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : c.bg,
          borderColor: highlight ? colors.warning : selected ? colors.primary : 'transparent',
        },
      ]}
    >
      {icon && <Ionicons name={icon} size={14} color={selected ? colors.primary : c.fg} />}
      <AppText variant="secondary" numeric style={{ color: selected ? colors.primary : c.fg }} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    minHeight: 32,
  },
});
