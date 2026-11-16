import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { CapacityBar } from '../../components/CapacityBar';
import { Card } from '../../components/Card';
import { DayTimeline } from '../../components/DayTimeline';
import { EmptyState } from '../../components/EmptyState';
import { Screen } from '../../components/Screen';
import { SpaceFilterControl } from '../../components/SpaceFilterControl';
import { useNow } from '../../hooks/useNow';
import { vi } from '../../i18n/vi';
import { DEFAULT_STUDY_WINDOWS, DEFAULT_WORK_HOURS } from '../../lib/defaults';
import { computeLoads } from '../../lib/planning/capacity';
import { formatDayHeader } from '../../lib/time/format';
import { workWindows } from '../../lib/time/slots';
import { dateKeyOf, localToInstant } from '../../lib/time/tz';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';

/**
 * Today — "What should I do today, and is today realistic?"
 * Phase 1: date header, space filter, capacity bars and the timeline (office-hours band,
 * now line) from default settings. Phase 2 wires tasks, blocks, classes and Google events.
 */
export function TodayScreen() {
  const { colors } = useTheme();
  const now = useNow();
  const filter = useUiStore((s) => s.spaceFilter.today);
  const today = dateKeyOf(now);

  const officeHours = useMemo(
    () =>
      workWindows({
        range: { start: localToInstant(today, 0), end: localToInstant(today, 1440) },
        workHours: DEFAULT_WORK_HOURS,
        studyWindows: DEFAULT_STUDY_WINDOWS,
        classSessions: [],
        exceptions: [],
        busy: [],
      }),
    [today],
  );
  const loads = useMemo(() => computeLoads([], [], [today]), [today]);
  const visibleLoads = loads.filter((l) => (filter === 'all' || l.space === filter) && l.maxMinutes > 0);

  return (
    <Screen
      title={formatDayHeader(today)}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={vi.tabs.settings}
          onPress={() => router.push('/settings')}
          style={[styles.avatar, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <Ionicons name="person-outline" size={20} color={colors.textBody} />
        </Pressable>
      }
    >
      <SpaceFilterControl screen="today" />

      {visibleLoads.length > 0 && (
        <Card>
          {visibleLoads.map((l) => (
            <CapacityBar key={`${l.date}-${l.space}`} load={l} />
          ))}
        </Card>
      )}

      <View style={styles.section}>
        <DayTimeline date={today} officeHours={filter === 'study' ? [] : officeHours} items={[]} now={now} />
      </View>

      <View style={styles.section}>
        <AppText variant="section">{vi.today.unscheduled}</AppText>
        <EmptyState icon="sunny-outline" title={vi.today.empty} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  avatar: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
