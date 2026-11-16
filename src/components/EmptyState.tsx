import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessible accessibilityLabel={[title, body].filter(Boolean).join('. ')}>
      <Ionicons name={icon} size={32} color={colors.textMuted} />
      <AppText variant="listTitle" style={styles.center}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="secondary" tone="muted" style={styles.center}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  center: { textAlign: 'center' },
});
