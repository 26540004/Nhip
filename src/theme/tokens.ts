/**
 * Design tokens — single source of truth. Structured as a theme object so a light
 * theme can be added later by providing another `ColorTokens` value.
 */
export interface ColorTokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  textHeading: string;
  textBody: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  study: string;
  studySoft: string;
  work: string;
  workSoft: string;
  /** Faint office-hours band on timelines. */
  workBand: string;
  success: string;
  warning: string;
  danger: string;
  /** Neutral grey for read-only Google Calendar events. */
  external: string;
  externalSoft: string;
}

export const darkColors: ColorTokens = {
  bg: '#0E1116',
  surface: '#161B22',
  surface2: '#1E242D',
  border: '#2A313C',
  textHeading: '#F2F4F7',
  textBody: '#C9D1DB',
  textMuted: '#8A94A3',
  primary: '#8B7CFF',
  primarySoft: 'rgba(139,124,255,0.14)',
  study: '#3FB6FF',
  studySoft: 'rgba(63,182,255,0.14)',
  work: '#FF9F43',
  workSoft: 'rgba(255,159,67,0.14)',
  workBand: 'rgba(255,159,67,0.05)',
  success: '#3DD68C',
  warning: '#F5C451',
  danger: '#FF6B6B',
  external: '#8A94A3',
  externalSoft: 'rgba(138,148,163,0.14)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { card: 16, sheet: 16, input: 12, button: 12, block: 8, chip: 999 } as const;

/** Minimum touch target (iOS HIG). */
export const touchTarget = 44;

export const motion = {
  sheetMs: 280,
  proposalStaggerMs: 40,
} as const;

export const breakpoints = { twoPane: 768, desktop: 1024 } as const;

export type Space = 'study' | 'work';

export function spaceColor(c: ColorTokens, space: Space): { solid: string; soft: string } {
  return space === 'study' ? { solid: c.study, soft: c.studySoft } : { solid: c.work, soft: c.workSoft };
}

export interface Theme {
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
}

export const darkTheme: Theme = { colors: darkColors, spacing, radius };
