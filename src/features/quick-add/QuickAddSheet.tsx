import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { vi } from '../../i18n/vi';
import { useUiStore } from '../../stores/ui';
import { spacing } from '../../theme/tokens';

/**
 * Quick Add (center ＋ / N). Phase 1 ships the sheet shell and shortcuts; natural-language
 * parsing (parse-task Edge Function) and saving arrive in Phase 2 with the data layer.
 */
export function QuickAddSheet() {
  const open = useUiStore((s) => s.quickAddOpen);
  const setOpen = useUiStore((s) => s.setQuickAddOpen);

  return (
    <Sheet visible={open} onClose={() => setOpen(false)} label={vi.tabs.add}>
      <View style={styles.body}>
        <AppText variant="section">{vi.comingSoon.title}</AppText>
        <AppText variant="secondary" tone="muted">
          {vi.comingSoon.body}
        </AppText>
      </View>
      <Button label={vi.common.close} variant="secondary" onPress={() => setOpen(false)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({ body: { gap: spacing.sm } });
