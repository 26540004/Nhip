/**
 * Office hours per weekday (start/end + optional lunch break). Each valid change is saved
 * right away; an invalid one stays as a draft with an inline message. Used in Settings and
 * in onboarding.
 */
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { TimeField } from '../../components/TimeField';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import type { WorkHoursRow } from '../../lib/api/types';
import { DEFAULT_OFFICE, hhmm, validateWorkHours, WEEK_ORDER } from '../../lib/settings/hours';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';

function fallbackRow(weekday: number): WorkHoursRow {
  return { weekday, enabled: weekday >= 1 && weekday <= 5, ...DEFAULT_OFFICE };
}

export function WorkHoursEditor({ rows, onSave }: { rows: WorkHoursRow[]; onSave: (rows: WorkHoursRow[]) => void }) {
  const { colors } = useTheme();
  const [drafts, setDrafts] = useState<Record<number, WorkHoursRow>>({});
  const [errors, setErrors] = useState<Record<number, string | null>>({});
  const rowOf = (d: number): WorkHoursRow => drafts[d] ?? rows.find((r) => r.weekday === d) ?? fallbackRow(d);

  const change = (d: number, patch: Partial<WorkHoursRow>) => {
    const next = { ...rowOf(d), ...patch };
    const err = next.enabled ? validateWorkHours(next) : null;
    setErrors((e) => ({ ...e, [d]: err ? (vi.settingsPages.invalid[err] ?? null) : null }));
    if (err) {
      setDrafts((x) => ({ ...x, [d]: next }));
      return;
    }
    setDrafts((x) => {
      const copy = { ...x };
      delete copy[d];
      return copy;
    });
    onSave([next]);
  };

  const copyMonday = () => {
    const mon = rowOf(1);
    if (validateWorkHours(mon)) return;
    onSave([2, 3, 4, 5].map((weekday) => ({ ...mon, weekday })));
    showToast(vi.settingsPages.workHours.copied);
  };

  return (
    <View style={styles.list}>
      {WEEK_ORDER.map((d) => {
        const r = rowOf(d);
        const hasLunch = r.break_start != null;
        return (
          <View key={d} style={[styles.day, { backgroundColor: colors.surface, borderColor: errors[d] ? colors.danger : colors.border }]}>
            <View style={styles.head}>
              <AppText variant="body" tone="heading" style={styles.flex}>
                {vi.weekdays[d]}
              </AppText>
              {!r.enabled && (
                <AppText variant="secondary" tone="muted">
                  {vi.settingsPages.workHours.off}
                </AppText>
              )}
              <Switch
                accessibilityLabel={`${vi.weekdays[d]}: ${vi.settingsPages.workHours.title}`}
                value={r.enabled}
                onValueChange={(v) => change(d, { enabled: v })}
                trackColor={{ true: colors.primary, false: colors.surface2 }}
                thumbColor={colors.textHeading}
                {...({ activeThumbColor: colors.textHeading } as object)}
              />
            </View>
            {r.enabled && (
              <>
                <View style={styles.times}>
                  <TimeField
                    compact
                    label={`${vi.weekdays[d]} · ${vi.settingsPages.workHours.start}`}
                    value={hhmm(r.start_time)}
                    onChange={(v) => change(d, { start_time: v })}
                  />
                  <AppText variant="body" tone="muted">
                    →
                  </AppText>
                  <TimeField
                    compact
                    label={`${vi.weekdays[d]} · ${vi.settingsPages.workHours.end}`}
                    value={hhmm(r.end_time)}
                    onChange={(v) => change(d, { end_time: v })}
                  />
                </View>
                <View style={styles.times}>
                  <Switch
                    accessibilityLabel={`${vi.weekdays[d]}: ${vi.settingsPages.workHours.lunch}`}
                    value={hasLunch}
                    onValueChange={(v) =>
                      change(d, v ? { break_start: '12:00', break_end: '13:00' } : { break_start: null, break_end: null })
                    }
                    trackColor={{ true: colors.primary, false: colors.surface2 }}
                    thumbColor={colors.textHeading}
                    {...({ activeThumbColor: colors.textHeading } as object)}
                  />
                  <AppText variant="secondary" tone={hasLunch ? 'body' : 'muted'}>
                    {vi.settingsPages.workHours.lunch}
                  </AppText>
                  {hasLunch && (
                    <>
                      <TimeField
                        compact
                        label={`${vi.weekdays[d]} · ${vi.settingsPages.workHours.lunchFrom}`}
                        value={hhmm(r.break_start)}
                        onChange={(v) => change(d, { break_start: v })}
                      />
                      <AppText variant="body" tone="muted">
                        →
                      </AppText>
                      <TimeField
                        compact
                        label={`${vi.weekdays[d]} · ${vi.settingsPages.workHours.lunch} ${vi.settingsPages.workHours.lunchTo}`}
                        value={hhmm(r.break_end)}
                        onChange={(v) => change(d, { break_end: v })}
                      />
                    </>
                  )}
                </View>
              </>
            )}
            {errors[d] ? (
              <AppText variant="secondary" tone="danger" accessibilityLiveRegion="polite">
                {errors[d]}
              </AppText>
            ) : null}
          </View>
        );
      })}
      <Button label={vi.settingsPages.workHours.copyWeekdays} variant="secondary" onPress={copyMonday} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.sm },
  day: { borderRadius: radius.card, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  times: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
