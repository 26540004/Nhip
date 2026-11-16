import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { vi } from '../i18n/vi';
import type { DayLoad } from '../lib/planning/capacity';
import { formatDurationCompact, formatDurationLong } from '../lib/time/format';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * "Việc 5g20 / 6g" capacity bar. Fill is the space color; warning at ≥ 90 %, danger above
 * 100 % with "Quá tải 40 phút". Status is always icon + label, never color alone.
 */
export function CapacityBar({ load, onRebalance }: { load: DayLoad; onRebalance?: () => void }) {
  const { colors } = useTheme();
  const spaceColor = load.space === 'study' ? colors.study : colors.work;
  const fill = load.status === 'over' ? colors.danger : load.status === 'near' ? colors.warning : spaceColor;
  const pct = load.maxMinutes === 0 ? (load.usedMinutes > 0 ? 1 : 0) : Math.min(1, load.usedMinutes / load.maxMinutes);
  const label = vi.capacity.label(
    vi.spaceFilter[load.space],
    formatDurationCompact(load.usedMinutes),
    formatDurationCompact(load.maxMinutes),
  );

  return (
    <View
      accessible
      accessibilityLabel={`${label}${load.status === 'over' ? `, ${vi.capacity.over(formatDurationLong(load.overMinutes))}` : ''}`}
      style={styles.wrap}
    >
      <View style={styles.header}>
        <AppText variant="secondary" numeric>
          {label}
        </AppText>
        {load.status === 'near' && (
          <View style={styles.status}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
            <AppText variant="meta" tone="warning">
              {vi.capacity.near}
            </AppText>
          </View>
        )}
        {load.status === 'over' && (
          <View style={styles.status}>
            <Ionicons name="warning-outline" size={14} color={colors.danger} />
            <AppText variant="meta" tone="danger" numeric>
              {vi.capacity.over(formatDurationLong(load.overMinutes))}
            </AppText>
          </View>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: colors.surface2 }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: fill }]} />
      </View>
      {load.status === 'over' && onRebalance && (
        <Button label={vi.capacity.rebalance} variant="secondary" onPress={onRebalance} style={styles.rebalance} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  track: { height: 6, borderRadius: radius.chip, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.chip },
  rebalance: { alignSelf: 'flex-start', marginTop: spacing.xs },
});
