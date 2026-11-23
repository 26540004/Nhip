/** Root ErrorBoundary screen: plain components only (providers may be what crashed). */
import { router, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { vi } from '../../i18n/vi';
import { isReporting, reportException } from '../../lib/errors/reporter';
import { darkColors as c } from '../../theme/tokens';

export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const reported = isReporting();
  useEffect(() => reportException(error, 'crash'), [error]);
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text style={[styles.title, { color: c.textHeading }]}>{vi.crash.title}</Text>
      <Text style={[styles.body, { color: c.textMuted }]}>{vi.crash.body}</Text>
      {reported && <Text style={[styles.meta, { color: c.textMuted }]}>{vi.crash.reported}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.crash.retry}
        onPress={() => void retry()}
        style={[styles.btn, { backgroundColor: c.primary }]}
      >
        <Text style={styles.btnText}>{vi.crash.retry}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.crash.home}
        onPress={() => {
          router.replace('/');
          void retry();
        }}
        style={[styles.btn, { backgroundColor: c.surface2 }]}
      >
        <Text style={[styles.btnText, { color: c.textHeading }]}>{vi.crash.home}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 13 },
  btn: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 16, fontWeight: '600', color: '#0E1116' },
});
