/** Floating "✦ AI xếp lịch" (the only element with a violet glow) + range chooser. */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { vi } from '../../i18n/vi';
import { spacing } from '../../theme/tokens';
import { useStartPlan } from './useStartPlan';

export function AiPlanButton() {
  const [open, setOpen] = useState(false);
  const { start, busy } = useStartPlan();
  const pick = async (range: 'today' | 'tomorrow' | 'week') => {
    await start({ range });
    setOpen(false);
  };
  return (
    <>
      <View pointerEvents="box-none" style={styles.fabWrap}>
        <Button
          label={busy ? vi.aiPlan.working : vi.aiPlan.button}
          variant="ai"
          loading={busy}
          onPress={() => setOpen(true)}
          style={styles.fab}
        />
      </View>
      <Sheet visible={open} onClose={() => !busy && setOpen(false)} label={vi.aiPlan.chooseRange}>
        <AppText variant="section">{vi.aiPlan.chooseRange}</AppText>
        {busy ? (
          <Button label={vi.aiPlan.working} variant="ai" loading onPress={() => undefined} />
        ) : (
          (['today', 'tomorrow', 'week'] as const).map((r) => (
            <Button key={r} label={vi.aiPlan.ranges[r]} variant={r === 'today' ? 'ai' : 'secondary'} onPress={() => void pick(r)} />
          ))
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  fabWrap: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, left: spacing.lg, alignItems: 'flex-end' },
  fab: { paddingHorizontal: spacing.xl },
});
