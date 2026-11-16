import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../src/components/AppText';
import { Button } from '../src/components/Button';
import { errorMessage } from '../src/components/QueryState';
import { isAppleSignInAvailable, signInWithApple, signInWithGoogle } from '../src/features/auth/signIn';
import { vi } from '../src/i18n/vi';
import { ApiError } from '../src/lib/api/supabase';
import { useTheme } from '../src/theme/ThemeProvider';
import { spacing } from '../src/theme/tokens';

export default function SignIn() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void isAppleSignInAvailable().then(setApple);
  }, []);

  const run = (which: 'apple' | 'google', fn: () => Promise<void>) => async () => {
    setBusy(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'auth_cancelled')) setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + 80, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="pulse" size={36} color={colors.primary} />
        </View>
        <AppText variant="display" accessibilityRole="header">
          {vi.appName}
        </AppText>
        <AppText variant="body" tone="muted" style={styles.center}>
          {vi.auth.tagline}
        </AppText>
      </View>
      <View style={styles.actions}>
        {apple && (
          <Button
            label={vi.auth.apple}
            variant="secondary"
            loading={busy === 'apple'}
            disabled={busy !== null}
            icon={<Ionicons name="logo-apple" size={18} color={colors.textHeading} />}
            onPress={run('apple', signInWithApple)}
          />
        )}
        <Button
          label={vi.auth.google}
          variant="secondary"
          loading={busy === 'google'}
          disabled={busy !== null}
          icon={<Ionicons name="logo-google" size={16} color={colors.textHeading} />}
          onPress={run('google', signInWithGoogle)}
        />
        {error && (
          <AppText variant="secondary" tone="danger" style={styles.center} accessibilityRole="alert">
            {error}
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: spacing.md },
  logo: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  actions: { gap: spacing.md, width: '100%', maxWidth: 420, alignSelf: 'center' },
});
