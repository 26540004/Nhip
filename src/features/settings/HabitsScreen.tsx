/**
 * "Nhịp hiểu về bạn": the habit profile, fully visible and editable.
 * Three quick starts: answer 2 questions · paste old notes · edit the vocabulary directly.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { windowLabel, type Period } from '../../../supabase/functions/_shared/habits-core.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { askConfirm } from '../../components/ConfirmHost';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { errorMessage } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { vi } from '../../i18n/vi';
import {
  type HabitAnswers,
  type LearnedTermDto,
  learnStyle,
  useAddVocab,
  useDeleteCorrection,
  useDeleteVocab,
  useHabits,
  useResetHabits,
  useSaveHabitSettings,
  vocabRow,
} from '../../lib/api/habits';
import { useCollections, useSettings } from '../../lib/api/queries';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, touchTarget } from '../../theme/tokens';

const PERIOD_KEYS: Period[] = ['morning', 'afternoon', 'evening', 'night'];
const h = vi.habits;

export function HabitsScreen() {
  const { colors } = useTheme();
  const habits = useHabits();
  const privacy = useSettings().data?.profile?.ai_privacy_mode ?? false;
  const collections = (useCollections().data ?? []).filter((c) => !c.archived);
  const saveSettings = useSaveHabitSettings();
  const reset = useResetHabits();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  const b = habits.data;
  const nameOf = (id: string | null) => collections.find((c) => c.id === id)?.name ?? null;

  const setAnswers = (patch: Partial<HabitAnswers>) => saveSettings.mutate({ answers: { ...(b?.answers ?? {}), ...patch } });

  return (
    <Screen title={h.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <AppText variant="secondary" tone="muted">
        {h.intro}
      </AppText>

      <Card>
        <View style={styles.row}>
          <AppText variant="body" tone="heading" style={styles.flex}>
            {h.learning}
          </AppText>
          <Switch
            accessibilityLabel={h.learning}
            value={b?.learningEnabled ?? true}
            disabled={!b}
            onValueChange={(v) => saveSettings.mutate({ learning_enabled: v })}
            trackColor={{ true: colors.primary, false: colors.surface2 }}
            thumbColor={colors.textHeading}
            {...({ activeThumbColor: colors.textHeading } as object)}
          />
        </View>
        <AppText variant="secondary" tone="muted">
          {h.learningHelp}
        </AppText>
        {privacy && (
          <AppText variant="secondary" tone="warning">
            {h.privacyNote}
          </AppText>
        )}
      </Card>

      <Section title={h.sections.questions}>
        <Card>
          <AppText variant="body" tone="heading">
            {h.overrunQ}
          </AppText>
          <View style={styles.wrap}>
            {(['often', 'sometimes', 'rarely'] as const).map((k) => (
              <Chip key={k} label={h.overrun[k]} selected={b?.answers.overrun === k} onPress={() => setAnswers({ overrun: k })} />
            ))}
          </View>
          {(['study', 'work'] as const).map((space) => {
            const key = space === 'study' ? 'focus_study' : 'focus_work';
            const value = b?.answers[key] ?? [];
            return (
              <View key={space} style={styles.gapSm}>
                <AppText variant="body" tone="heading">
                  {h.focusQ(space === 'study' ? 'việc học' : 'việc làm')}
                </AppText>
                <View style={styles.wrap}>
                  {PERIOD_KEYS.map((p) => (
                    <Chip
                      key={p}
                      label={h.periods[p]}
                      tone={space}
                      selected={value.includes(p)}
                      onPress={() => setAnswers({ [key]: value.includes(p) ? value.filter((x) => x !== p) : [...value, p] })}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title={h.sections.estimates}>
        <Card>
          {b && b.profile.estimates.some((e) => e.n > 0 || b.answers.overrun) ? (
            <>
              {b.profile.estimates
                .filter((e) => e.n > 0 || e.key === 'study' || e.key === 'work')
                .map((e) => (
                  <View key={e.key} style={styles.statRow}>
                    <View style={styles.flex}>
                      <AppText variant="body" tone="heading">
                        {e.label}
                      </AppText>
                      <AppText variant="meta" tone="muted">
                        {h.estimateMeta(e.n, e.confidence)}
                      </AppText>
                    </View>
                    <AppText variant="secondary" numeric tone={e.ratio >= 1.1 ? 'warning' : undefined}>
                      {h.estimateLine(e.ratio)}
                    </AppText>
                  </View>
                ))}
              <AppText variant="meta" tone="muted">
                {h.estimateApplied}
              </AppText>
            </>
          ) : (
            <AppText variant="secondary" tone="muted">
              {h.estimateEmpty}
            </AppText>
          )}
        </Card>
      </Section>

      <Section title={h.sections.focus}>
        <Card>
          {b && b.profile.focus.length ? (
            (['study', 'work'] as const).map((space) => {
              const list = b.profile.focus.filter((f) => f.space === space);
              if (!list.length) return null;
              return (
                <View key={space} style={styles.gapSm}>
                  <AppText variant="meta" tone="muted">
                    {space === 'study' ? 'Học tập' : 'Công việc'}
                  </AppText>
                  <View style={styles.wrap}>
                    {list.map((f) => (
                      <Chip
                        key={f.hour}
                        tone={space}
                        label={`${windowLabel(f.hour)} · ${f.n ? h.focusFromData(f.n) : h.focusFromAnswers}`}
                      />
                    ))}
                  </View>
                </View>
              );
            })
          ) : (
            <AppText variant="secondary" tone="muted">
              {h.focusEmpty}
            </AppText>
          )}
        </Card>
      </Section>

      <Section title={h.sections.vocab}>
        <VocabEditor collections={collections} />
        {b && b.vocab.length === 0 && (
          <AppText variant="secondary" tone="muted">
            {h.vocabEmpty}
          </AppText>
        )}
        {b?.vocab.map((v) => (
          <VocabItem
            key={v.id}
            id={v.id}
            short={v.short}
            meaning={nameOf(v.collection_id) ?? v.meaning}
            source={v.source}
            linked={!!v.collection_id}
          />
        ))}
      </Section>

      <Section title={h.sections.importer}>
        <Importer disabled={privacy} known={(b?.vocab ?? []).map((v) => v.short)} />
      </Section>

      <Section title={h.sections.corrections}>
        <Corrections />
      </Section>

      <Button
        label={h.reset}
        variant="secondary"
        disabled={!b}
        onPress={() =>
          void askConfirm(h.resetConfirm, h.reset).then((ok) => {
            if (!ok) return;
            reset.mutate(undefined);
            showToast(h.resetDone);
          })
        }
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.gapSm}>
      <AppText variant="meta" tone="muted" accessibilityRole="header">
        {title.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

function VocabEditor({ collections }: { collections: readonly { id: string; name: string; space: 'study' | 'work' }[] }) {
  const add = useAddVocab();
  const [short, setShort] = useState('');
  const [meaning, setMeaning] = useState('');
  const [col, setCol] = useState<string | null>(null);
  const picked = collections.find((c) => c.id === col);
  const canAdd = short.trim().length > 0 && (meaning.trim().length > 0 || !!picked);
  const submit = () => {
    if (!canAdd) return;
    add.mutate([vocabRow(short, meaning.trim() || picked!.name, col, 'user')]);
    setShort('');
    setMeaning('');
    setCol(null);
  };
  return (
    <Card>
      <View style={styles.fields}>
        <View style={styles.shortField}>
          <TextField label={h.short} placeholder={h.shortPh} value={short} onChangeText={setShort} autoCapitalize="none" maxLength={40} />
        </View>
        <View style={styles.flex}>
          <TextField
            label={h.meaning}
            placeholder={picked?.name ?? h.meaningPh}
            value={meaning}
            onChangeText={setMeaning}
            maxLength={120}
            onSubmitEditing={submit}
          />
        </View>
      </View>
      {collections.length > 0 && (
        <>
          <AppText variant="meta" tone="muted">
            {h.linkTo}
          </AppText>
          <View style={styles.wrap}>
            {collections.map((c) => (
              <Chip key={c.id} label={c.name} tone={c.space} selected={col === c.id} onPress={() => setCol(col === c.id ? null : c.id)} />
            ))}
          </View>
        </>
      )}
      <Button label={h.add} icon="add" variant="secondary" disabled={!canAdd} onPress={submit} />
    </Card>
  );
}

function VocabItem({
  id,
  short,
  meaning,
  source,
  linked,
}: {
  id: string;
  short: string;
  meaning: string;
  source: 'user' | 'learned' | 'import';
  linked: boolean;
}) {
  const { colors } = useTheme();
  const del = useDeleteVocab();
  return (
    <View style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.flex}>
        <AppText variant="body" tone="heading">
          {short} <AppText tone="muted">= {meaning}</AppText>
        </AppText>
        <AppText variant="meta" tone="muted">
          {h.source[source]}
          {linked ? ' · môn học / dự án' : ''}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={h.deleteVocab(short)}
        onPress={() => del.mutate(id)}
        hitSlop={8}
        style={styles.iconBtn}
      >
        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function Importer({ disabled, known }: { disabled: boolean; known: readonly string[] }) {
  const add = useAddVocab();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<LearnedTermDto[] | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  const run = async () => {
    if (text.trim().length < 20) return showToast(h.importTooShort);
    setBusy(true);
    try {
      const res = await learnStyle(text.trim());
      const fresh = res.terms.filter((t) => !known.some((k) => k.toLowerCase() === t.short.toLowerCase()));
      setTerms(fresh);
      setKeep(new Set(fresh.map((t) => t.short)));
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const rows = (terms ?? []).filter((t) => keep.has(t.short)).map((t) => vocabRow(t.short, t.meaning, t.collection_id, 'import'));
    if (rows.length) add.mutate(rows);
    showToast(h.importSaved(rows.length));
    setTerms(null);
    setText('');
  };

  if (disabled)
    return (
      <Card>
        <AppText variant="secondary" tone="muted">
          {vi.errors.privacy_mode}
        </AppText>
      </Card>
    );
  return (
    <Card ai>
      <AppText variant="secondary" tone="muted">
        {h.importHelp}
      </AppText>
      {terms == null ? (
        <>
          <TextField
            multiline
            placeholder={h.importPh}
            value={text}
            onChangeText={setText}
            maxLength={20_000}
            style={styles.paste}
            accessibilityLabel={h.sections.importer}
          />
          <Button
            label={h.importRun}
            icon="sparkles"
            loading={busy}
            disabled={busy || text.trim().length === 0}
            onPress={() => void run()}
          />
        </>
      ) : terms.length === 0 ? (
        <>
          <AppText variant="body">{h.importNone}</AppText>
          <Button label={vi.common.close} variant="secondary" onPress={() => setTerms(null)} />
        </>
      ) : (
        <>
          <View style={styles.wrap}>
            {terms.map((t) => (
              <Chip
                key={t.short}
                label={`${t.short} = ${t.meaning}`}
                selected={keep.has(t.short)}
                onPress={() =>
                  setKeep((s) => {
                    const n = new Set(s);
                    if (n.has(t.short)) n.delete(t.short);
                    else n.add(t.short);
                    return n;
                  })
                }
              />
            ))}
          </View>
          <Button label={h.importSave(keep.size)} disabled={keep.size === 0} onPress={save} />
        </>
      )}
    </Card>
  );
}

function Corrections() {
  const { colors } = useTheme();
  const b = useHabits().data;
  const del = useDeleteCorrection();
  if (!b) return null;
  if (b.corrections.length === 0)
    return (
      <AppText variant="secondary" tone="muted">
        {h.correctionsEmpty}
      </AppText>
    );
  return (
    <>
      {b.corrections.slice(0, 10).map((c) => (
        <View key={c.id} style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.flex}>
            <AppText variant="secondary" tone="heading" numberOfLines={2}>
              “{c.input_text}”
            </AppText>
            <AppText variant="meta" tone="muted">
              {h.correctionLine(h.fields[c.field], c.ai_value, c.user_value)}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={h.deleteCorrection}
            onPress={() => del.mutate(c.id)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gapSm: { gap: spacing.sm },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  fields: { flexDirection: 'row', gap: spacing.sm },
  shortField: { width: 110 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  paste: { minHeight: 120, textAlignVertical: 'top' },
});
