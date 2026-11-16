import { createContext, useContext, type ReactNode } from 'react';
import { darkTheme, type Theme } from './tokens';

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({ children, theme = darkTheme }: { children: ReactNode; theme?: Theme }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
