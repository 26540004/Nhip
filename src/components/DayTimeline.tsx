import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { vi } from '../i18n/vi';
import type { Interval } from '../lib/time/intervals';
import { formatTimeRange } from '../lib/time/format';
import { APP_TZ, type DateKey, MINUTE, localToInstant } from '../lib/time/tz';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';

export const TIMELINE_START_HOUR = 6;
const HOUR_HEIGHT = 56;
const GUTTER = 48;
const PAD = 10;

export interface TimelineItem extends Interval {
  id: string;
  kind: 'class' | 'block' | 'external';
  space?: 'study' | 'work';
  title: string;
  /** Proposed AI blocks render with a dashed violet outline. */
  proposed?: boolean;
  onPress?: () => void;
}

/**
 * Vertical day timeline 06:00–24:00: office-hours band, class/task/Google blocks, and a
 * "now" line that auto-scrolls into view. Blocks: 3px left bar + soft fill + title + range.
 */
export function DayTimeline({
  date,
  officeHours,
  items,
  now,
  tz = APP_TZ,
  height = 520,
}: {
  date: DateKey;
  officeHours: Interval[];
  items: TimelineItem[];
  now: number;
  tz?: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [scrolled, setScrolled] = useState(false);
  const dayStart = localToInstant(date, TIMELINE_START_HOUR * 60, tz);
  const dayEnd = localToInstant(date, 1440, tz);
  const y = (t: number) => ((Math.min(Math.max(t, dayStart), dayEnd) - dayStart) / (60 * MINUTE)) * HOUR_HEIGHT;
  const totalHeight = (24 - TIMELINE_START_HOUR) * HOUR_HEIGHT;
  const nowVisible = now >= dayStart && now < dayEnd;

  useEffect(() => {
    if (scrolled || !nowVisible) return;
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y(now) - height / 3), animated: false });
      setScrolled(true);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowVisible, scrolled]);

  const hours = Array.from({ length: 24 - TIMELINE_START_HOUR }, (_, i) => TIMELINE_START_HOUR + i);

  return (
    <ScrollView ref={scrollRef} style={{ height }} nestedScrollEnabled accessibilityLabel={vi.tabs.today}>
      <View style={{ height: totalHeight + PAD * 2, paddingTop: PAD }}>
        <View style={{ height: totalHeight }}>
        {hours.map((h) => (
          <View key={h} style={[styles.hourRow, { top: (h - TIMELINE_START_HOUR) * HOUR_HEIGHT, borderTopColor: colors.border }]}>
            <AppText variant="meta" tone="muted" numeric style={styles.hourLabel}>
              {`${String(h).padStart(2, '0')}:00`}
            </AppText>
          </View>
        ))}

        {officeHours.map((o, i) => (
          <View
            key={`office-${i}`}
            importantForAccessibility="no-hide-descendants"
            style={[styles.band, { top: y(o.start), height: y(o.end) - y(o.start), backgroundColor: colors.workBand }]}
          />
        ))}

        {items
          .filter((it) => it.end > dayStart && it.start < dayEnd)
          .sort((a, b) => a.start - b.start)
          .map((it) => {
            const tone =
              it.kind === 'external'
                ? { bar: colors.external, fill: colors.externalSoft }
                : it.kind === 'class' || it.space === 'study'
                  ? { bar: colors.study, fill: it.kind === 'class' ? 'rgba(63,182,255,0.28)' : colors.studySoft }
                  : { bar: colors.work, fill: colors.workSoft };
            const top = y(it.start);
            const h = Math.max(24, y(it.end) - top);
            const range = formatTimeRange(it.start, it.end, tz);
            return (
              <Pressable
                key={it.id}
                disabled={!it.onPress}
                onPress={it.onPress}
                accessibilityRole={it.onPress ? 'button' : 'text'}
                accessibilityLabel={`${it.kind === 'class' ? `${vi.today.classTag}: ` : ''}${it.title}, ${range}`}
                style={[
                  styles.block,
                  { top, height: h, backgroundColor: it.proposed ? colors.primarySoft : tone.fill, borderLeftColor: it.proposed ? colors.primary : tone.bar },
                  it.proposed && { borderStyle: 'dashed', borderWidth: 1, borderColor: colors.primary },
                ]}
              >
                <View style={styles.blockRow}>
                  {it.kind === 'class' && (
                    <View style={[styles.tag, { backgroundColor: colors.study }]}>
                      <AppText variant="meta" style={{ color: '#0E1116' }}>
                        {vi.today.classTag}
                      </AppText>
                    </View>
                  )}
                  <AppText variant="secondary" tone="heading" numberOfLines={1} style={styles.flex}>
                    {it.title}
                  </AppText>
                </View>
                {h >= 40 && (
                  <AppText variant="meta" tone="muted" numeric>
                    {range}
                  </AppText>
                )}
              </Pressable>
            );
          })}

        {nowVisible && (
          <View pointerEvents="none" style={[styles.now, { top: y(now) }]}>
            <View style={[styles.nowDot, { backgroundColor: colors.primary }]} />
            <View style={[styles.nowLine, { backgroundColor: colors.primary }]} />
          </View>
        )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hourRow: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  hourLabel: { width: GUTTER - 8, marginTop: -8, backgroundColor: 'transparent' },
  band: { position: 'absolute', left: GUTTER, right: 0 },
  block: {
    position: 'absolute',
    left: GUTTER + 4,
    right: 4,
    borderRadius: radius.block,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  tag: { borderRadius: radius.chip, paddingHorizontal: 6 },
  now: { position: 'absolute', left: GUTTER - 4, right: 0, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  nowLine: { flex: 1, height: 2 },
});
