import type { TextStyle } from 'react-native';

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

const heading = (size: number, family: string): TextStyle => ({
  fontSize: size,
  lineHeight: Math.round(size * 1.2),
  fontFamily: family,
});

const body = (size: number, family: string = fontFamily.regular): TextStyle => ({
  fontSize: size,
  lineHeight: Math.round(size * 1.45),
  fontFamily: family,
});

export const type = {
  meta: body(12),
  secondary: body(14),
  body: body(16),
  listTitle: body(18, fontFamily.medium),
  section: heading(22, fontFamily.semibold),
  screenTitle: heading(28, fontFamily.bold),
  display: heading(36, fontFamily.bold),
} as const;

/** Apply to every time, duration and counter so digits don't jitter. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };
