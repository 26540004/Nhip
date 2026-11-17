/**
 * Time field: a pill showing "08:00"; tapping opens a sheet with an hour grid and minute
 * chips (00 / 15 / 30 / 45, plus the current minute if it is something else). Same on iPhone
 * and web, large touch targets, no free-text typing errors.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { vi } from '../i18n/vi';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Sheet } from './Sheet';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const BASE_MINUTES = [0, 15, 30, 45];

export function TimeField({
  label,
  value,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const shown = value ? value.slice(0, 5) : '--:--';
  const [h, m] = (value ?? '08:00').split(':').map(Number) as [number, number];
  const [hour, setHour] = useState(h);
  const [minute, setMinute] = useState(m);
  const minutes = BASE_MINUTES.includes(minute) ? BASE_MINUTES : [...BASE_MINUTES, minute].sort((a, b) => a - b);

  const openSheet = () => {
    setHour(h);
    setMinute(m);
    setOpen(true);
  };
  const commit = () => {
    setOpen(false);
    const next = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (next !== shown) onChange(next);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={vi.timePicker.label(label, shown)}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={openSheet}
        style={({ pressed }) => [
          styles.pill,
          compact && styles.compact,
          { backgroundColor: colors.surface2, borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        ]}
      >
        <AppText variant="body" tone="heading" numeric>
          {shown}
        </AppText>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} label={label}>
        <View style={styles.sheet}>
          <View style={styles.headRow}>
            <AppText variant="section">{label}</AppText>
            <AppText variant="section" tone="primary" numeric>
              {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
            </AppText>
          </View>
          <AppText variant="meta" tone="muted">
            {vi.timePicker.hour.toUpperCase()}
          </AppText>
          <View style={styles.grid}>
            {HOURS.map((x) => (
              <Cell
                key={x}
                label={String(x).padStart(2, '0')}
                selected={x === hour}
                onPress={() => setHour(x)}
                a11y={`${x} ${vi.timePicker.hour}`}
              />
            ))}
          </View>
          <AppText variant="meta" tone="muted">
            {vi.timePicker.minute.toUpperCase()}
          </AppText>
          <View style={styles.grid}>
            {minutes.map((x) => (
              <Cell
                key={x}
                label={`:${String(x).padStart(2, '0')}`}
                selected={x === minute}
                onPress={() => setMinute(x)}
                a11y={`${x} ${vi.timePicker.minute}`}
                wide
              />
            ))}
          </View>
          <Button label={vi.timePicker.done} onPress={commit} />
        </View>
      </Sheet>
    </>
  );
}

function Cell({
  label,
  selected,
  onPress,
  a11y,
  wide,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  a11y: string;
  wide?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        wide && styles.wide,
        { backgroundColor: selected ? colors.primary : colors.surface2, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <AppText variant="body" numeric style={{ color: selected ? '#0E1116' : colors.textHeading }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 76,
    minHeight: touchTarget,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  compact: { minWidth: 68, paddingHorizontal: spacing.sm },
  sheet: { gap: spacing.md },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cell: { width: '15%', minWidth: 48, height: touchTarget, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  wide: { width: '22%' },
});
