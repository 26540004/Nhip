/** A row in Settings that opens a sub-page: icon, title, one-line summary, chevron. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { vi } from '../i18n/vi';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

export function SettingsRow({
  icon,
  title,
  summary,
  onPress,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  summary?: string | null;
  onPress: () => void;
  tone?: 'warning';
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary ? `${title}. ${summary}` : title}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        { backgroundColor: hovered ? colors.surface2 : colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={tone === 'warning' ? colors.warning : colors.textBody} />
      <View style={styles.text}>
        <AppText variant="body" tone="heading">
          {title}
        </AppText>
        {summary ? (
          <AppText variant="secondary" tone={tone === 'warning' ? 'warning' : 'muted'} numberOfLines={2}>
            {summary}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export function WeekdayChips({ value, onChange, multi }: { value: number[]; onChange: (v: number[]) => void; multi?: boolean }) {
  const { colors } = useTheme();
  const order = [1, 2, 3, 4, 5, 6, 0];
  const short = vi.weekdaysShort;
  const long = vi.weekdays;
  return (
    <View style={styles.week} accessibilityRole="radiogroup">
      {order.map((d) => {
        const on = value.includes(d);
        return (
          <Pressable
            key={d}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityLabel={long[d]}
            accessibilityState={multi ? { checked: on } : { selected: on }}
            onPress={() => onChange(multi ? (on ? value.filter((x) => x !== d) : [...value, d]) : [d])}
            style={({ pressed }) => [styles.day, { backgroundColor: on ? colors.primary : colors.surface2, opacity: pressed ? 0.75 : 1 }]}
          >
            <AppText variant="secondary" style={{ color: on ? '#0E1116' : colors.textHeading, fontWeight: '600' }}>
              {short[d]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touchTarget + 12,
  },
  text: { flex: 1, gap: 2 },
  week: { flexDirection: 'row', gap: spacing.xs },
  day: {
    flex: 1,
    minWidth: 36,
    maxWidth: 56,
    height: touchTarget,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
