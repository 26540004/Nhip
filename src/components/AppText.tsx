import { Text, type TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { tabular, type as typeScale } from '../theme/typography';

export type TextVariant = keyof typeof typeScale;
export type TextTone = 'heading' | 'body' | 'muted' | 'primary' | 'danger' | 'warning' | 'success' | 'study' | 'work';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Tabular digits for times, durations, counters. */
  numeric?: boolean;
}

export function AppText({ variant = 'body', tone, numeric, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const defaultTone: TextTone =
    variant === 'screenTitle' || variant === 'section' || variant === 'display' || variant === 'listTitle' ? 'heading' : 'body';
  const toneColor: Record<TextTone, string> = {
    heading: colors.textHeading,
    body: colors.textBody,
    muted: colors.textMuted,
    primary: colors.primary,
    danger: colors.danger,
    warning: colors.warning,
    success: colors.success,
    study: colors.study,
    work: colors.work,
  };
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      style={[typeScale[variant], { color: toneColor[tone ?? defaultTone] }, numeric && tabular, style]}
      {...rest}
    />
  );
}
