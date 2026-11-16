import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, SplashScreen, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QuickAddSheet } from '../src/features/quick-add/QuickAddSheet';
import { useKeyboardShortcuts } from '../src/hooks/useKeyboardShortcuts';
import { QUERY_CACHE_BUSTER, queryClient, queryPersister } from '../src/lib/api/queryClient';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { darkColors } from '../src/theme/tokens';

void SplashScreen.preventAutoHideAsync();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkColors.bg,
    card: darkColors.surface,
    border: darkColors.border,
    text: darkColors.textHeading,
    primary: darkColors.primary,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useKeyboardShortcuts();

  useEffect(() => {
    // Fall back to the system font if Inter fails to load.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: darkColors.bg }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, buster: QUERY_CACHE_BUSTER }}>
          <ThemeProvider>
            <NavThemeProvider value={navTheme}>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: darkColors.bg } }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="settings/index" options={{ presentation: 'modal' }} />
              </Stack>
              <QuickAddSheet />
            </NavThemeProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
