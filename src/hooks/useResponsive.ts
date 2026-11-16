import { useWindowDimensions } from 'react-native';
import { breakpoints } from '../theme/tokens';

export type LayoutMode = 'phone' | 'twoPane' | 'desktop';

export function useResponsive(): { mode: LayoutMode; width: number } {
  const { width } = useWindowDimensions();
  const mode: LayoutMode = width >= breakpoints.desktop ? 'desktop' : width >= breakpoints.twoPane ? 'twoPane' : 'phone';
  return { mode, width };
}
