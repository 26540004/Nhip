/**
 * Keeps the single recorder alive for the whole signed-in app and shows a "● Đang ghi" pill
 * on every screen except the recorder itself, so a lecture keeps recording while the user
 * checks their tasks.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useAudioRecorder } from 'expo-audio';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { vi } from '../../i18n/vi';
import { formatDuration } from '../../lib/media/recording';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { RecorderEngine, recordingOptions, setEngine } from './engine';
import { elapsedSec, useRecorderStore } from './store';

export function RecorderHost() {
  const options = useMemo(() => recordingOptions(), []);
  const recorder = useAudioRecorder(options);
  const qc = useQueryClient();
  useEffect(() => {
    const engine = new RecorderEngine(recorder, qc);
    setEngine(engine);
    const detach = engine.attach();
    return () => {
      detach();
      setEngine(null);
    };
  }, [recorder, qc]);
  return <RecordingPill />;
}

function RecordingPill() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const status = useRecorderStore((s) => s.session?.status);
  const elapsed = useRecorderStore(elapsedSec);
  if (!status || pathname === '/record') return null;
  const tone = status === 'recording' ? colors.danger : colors.warning;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 84 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${vi.record.status[status]} ${formatDuration(elapsed)}. ${vi.record.openRecorder}`}
        onPress={() => router.push('/record')}
        style={[styles.pill, { backgroundColor: colors.surface, borderColor: tone }]}
      >
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <AppText variant="secondary" tone="heading" numeric>
          {vi.record.status[status]} · {formatDuration(elapsed)}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, zIndex: 50 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
