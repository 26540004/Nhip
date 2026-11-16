import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, SplashScreen, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastHost } from '../src/components/Toast';
import { SetupRequired } from '../src/features/auth/SetupRequired';
import { startSessionListener, useSession } from '../src/features/auth/session';
import { QuickAddSheet } from '../src/features/quick-add/QuickAddSheet';
import { useKeyboardShortcuts } from '../src/hooks/useKeyboardShortcuts';
import { useAutoSync } from '../src/hooks/useSync';
import { QUERY_CACHE_BUSTER, queryClient, queryPersister } from '../src/lib/api/queryClient';
import { isSupabaseConfigured } from '../src/lib/api/supabase';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { darkColors } from '../src/theme/tokens';

void SplashScreen.preventAutoHideAsync();
startSessionListener();

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
  const { session, ready } = useSession();
  useKeyboardShortcuts();

  const loaded = (fontsLoaded || Boolean(fontError)) && ready;
  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;

  const signedIn = Boolean(session);

  // Build without Supabase env vars: explain what to configure instead of a broken app.
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaProvider>
        <ThemeProvider>
          <StatusBar style="light" />
          <SetupRequired />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: darkColors.bg }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, buster: QUERY_CACHE_BUSTER }}
          // Replay writes made offline (or before the app was closed).
          onSuccess={() => void queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries())}
        >
          <ThemeProvider>
            <NavThemeProvider value={navTheme}>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: darkColors.bg } }}>
                <Stack.Protected guard={!signedIn}>
                  <Stack.Screen name="sign-in" />
                </Stack.Protected>
                <Stack.Protected guard={signedIn}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="task/[id]" />
                  <Stack.Screen name="note/[id]" />
                  <Stack.Screen name="search" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="settings/index" />
                  <Stack.Screen name="settings/collections" />
                  <Stack.Screen name="settings/google" />
                  <Stack.Screen name="plan" options={{ presentation: 'modal' }} />
                </Stack.Protected>
              </Stack>
              {signedIn && <QuickAddSheet />}
              {signedIn && <AutoSync />}
              <ToastHost />
            </NavThemeProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Google Calendar sync on app open / foreground (no UI). */
function AutoSync() {
  useAutoSync(true);
  return null;
}
