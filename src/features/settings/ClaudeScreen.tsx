/** "Claude tự sửa lỗi" — admin only. Toggle automatic reports, send a manual one, open GitHub. */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import { loadAutoReport, report, setAutoReport } from '../../lib/errors/reporter';
import { useIsAdmin } from '../../lib/errors/useAdmin';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';

const t = vi.claudeFix;
/** Optional (not secret): owner/name of the GitHub repo, for the "open issues" link. */
const REPO = process.env.EXPO_PUBLIC_GITHUB_REPO ?? '';

export function ClaudeScreen() {
  const { colors } = useTheme();
  const admin = useIsAdmin();
  const [auto, setAuto] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  useEffect(() => {
    void loadAutoReport().then(setAuto);
  }, []);

  const send = async () => {
    setBusy(true);
    const res = await report({ kind: 'manual', message: 'Báo lỗi thủ công', description: text.trim() }, { manual: true });
    setBusy(false);
    if (!res) return showToast(t.sendFailed, { tone: 'error' });
    showToast(res.issue ? t.sentIssue(res.issue) : t.sentStored);
    setText('');
  };

  return (
    <Screen title={t.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      {admin.data !== true ? (
        <AppText variant="secondary" tone="muted">
          {admin.isLoading ? vi.states.loading : t.adminOnly}
        </AppText>
      ) : (
        <>
          <AppText variant="secondary" tone="muted">
            {t.intro}
          </AppText>
          <Card>
            <View style={styles.row}>
              <AppText variant="body" tone="heading" style={styles.flex}>
                {t.auto}
              </AppText>
              <Switch
                accessibilityLabel={t.auto}
                value={auto}
                onValueChange={(v) => {
                  setAuto(v);
                  void setAutoReport(v);
                }}
                trackColor={{ true: colors.primary, false: colors.surface2 }}
                thumbColor={colors.textHeading}
              />
            </View>
            <AppText variant="secondary" tone="muted">
              {t.autoHelp}
            </AppText>
          </Card>
          <Card>
            <AppText variant="section">{t.manualTitle}</AppText>
            <AppText variant="secondary" tone="muted">
              {t.manualHelp}
            </AppText>
            <TextField
              multiline
              accessibilityLabel={t.manualTitle}
              placeholder={t.manualPh}
              value={text}
              onChangeText={setText}
              maxLength={2000}
              style={styles.box}
            />
            <Button label={t.send} icon="send" loading={busy} disabled={busy || text.trim().length < 5} onPress={() => void send()} />
          </Card>
          {REPO !== '' && (
            <Button
              label={t.openGithub}
              variant="secondary"
              icon="logo-github"
              onPress={() => void Linking.openURL(`https://github.com/${REPO}/issues?q=label%3Aauto-bug`)}
            />
          )}
          <AppText variant="meta" tone="muted">
            {t.privacy}
          </AppText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  box: { minHeight: 110, textAlignVertical: 'top' },
});
