// Import only the weights we use (the package index pulls in all 18 font files).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, router, SplashScreen, Stack, ThemeProvider as NavThemeProvider, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { RecorderHost } from '../src/features/record/RecorderHost';
import { useUploadWorker } from '../src/lib/media/useUploadWorker';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmHost } from '../src/components/ConfirmHost';
import { ToastHost } from '../src/components/Toast';
import { SetupRequired } from '../src/features/auth/SetupRequired';
import { startSessionListener, useSession } from '../src/features/auth/session';
import { QuickAddSheet } from '../src/features/quick-add/QuickAddSheet';
import { useKeyboardShortcuts } from '../src/hooks/useKeyboardShortcuts';
import { useNotifications } from '../src/hooks/useNotifications';
import { useAutoSync } from '../src/hooks/useSync';
import { useSettings } from '../src/lib/api/queries';
import { useAdminReporter } from '../src/lib/errors/useAdmin';
import { CrashScreen } from '../src/features/settings/CrashScreen';
import type { ErrorBoundaryProps } from 'expo-router';
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

/** Last resort when a screen crashes: report it (admin only) and offer a retry. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <CrashScreen {...props} />;
}

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
          persistOptions={{
            persister: queryPersister,
            buster: QUERY_CACHE_BUSTER,
            // Signed storage URLs expire; never restore them from disk.
            dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && q.meta?.persist !== false },
          }}
          // Replay writes made offline (or before the app was closed).
          onSuccess={() => void queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries())}
        >
          <ThemeProvider>
            <NavThemeProvider value={navTheme}>
              <StatusBar style="light" />
              <AppNavigator signedIn={signedIn} />
              {signedIn && <QuickAddSheet />}
              {signedIn && <AutoSync />}
              {signedIn && <RecorderHost />}
              <ConfirmHost />
              <ToastHost />
            </NavThemeProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Routes. A signed-in user who has not finished onboarding is sent to /onboarding from any
 * other page (one redirect rule only — combining it with Stack.Protected loops). The
 * onboarding screens stay reachable afterwards ("Xem lại hướng dẫn bắt đầu").
 */
function AppNavigator({ signedIn }: { signedIn: boolean }) {
  const settings = useSettings({ enabled: signedIn });
  const profile = settings.data?.profile;
  const needsOnboarding = signedIn && profile != null && !profile.onboarding_completed_at;
  const pathname = usePathname();
  useAdminReporter(signedIn);
  // Deep links / redirects to a protected page while onboarding is pending land on step 2.
  useEffect(() => {
    if (needsOnboarding && !pathname.startsWith('/onboarding'))
      router.replace({ pathname: '/onboarding/[step]', params: { step: 'google' } });
  }, [needsOnboarding, pathname]);
  // First sign-in without cached settings: wait briefly instead of flashing Today.
  if (signedIn && !settings.data && settings.isLoading) return <View style={{ flex: 1, backgroundColor: darkColors.bg }} />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: darkColors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="onboarding/[step]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="note/[id]" />
        <Stack.Screen name="search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/collections" />
        <Stack.Screen name="settings/google" />
        <Stack.Screen name="settings/reminders" />
        <Stack.Screen name="settings/work-hours" />
        <Stack.Screen name="settings/timetable" />
        <Stack.Screen name="settings/study-windows" />
        <Stack.Screen name="settings/capacity" />
        <Stack.Screen name="settings/data" />
        <Stack.Screen name="settings/habits" />
        <Stack.Screen name="settings/claude" />
        <Stack.Screen name="plan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="brief" />
        <Stack.Screen name="review" />
        <Stack.Screen name="record" options={{ gestureEnabled: false }} />
        <Stack.Screen name="viewer" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack.Protected>
    </Stack>
  );
}

/** Google Calendar sync + local reminders / push registration (no UI). */
function AutoSync() {
  useAutoSync(true);
  useNotifications();
  useUploadWorker(true);
  return null;
}
