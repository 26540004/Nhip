import { useQueryClient } from '@tanstack/react-query';
/**
 * Quick Add (center ＋ / N).
 * Type a Vietnamese sentence → parse-task returns one or more preview cards with editable
 * chips (space, collection, deadline, estimate, priority, suggested subtasks) → Lưu.
 * When AI is unavailable / offline / over quota, the sentence can be saved as-is to the
 * inbox with the "Chưa phân tích" tag and re-parsed later.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { guessSpace } from '../../../supabase/functions/_shared/vi-parse.ts';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import {
  CollectionPicker,
  DeadlineEditor,
  EstimatePicker,
  formatDeadlineShort,
  PriorityPicker,
  SpacePicker,
} from '../../components/FieldEditors';
import { errorMessage } from '../../components/QueryState';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import { useNow } from '../../hooks/useNow';
import { vi } from '../../i18n/vi';
import { parseTask } from '../../lib/api/functions';
import { type CorrectionRow, useAddVocab, useHabits, type VocabRow, vocabRow } from '../../lib/api/habits';
import { enqueueWrite, newId, type TaskCreate, useCreateLinks, useCreateTasks } from '../../lib/api/mutations';
import { useCollections } from '../../lib/api/queries';
import { ApiError } from '../../lib/api/supabase';
import type { ParsedTask } from '../../lib/api/types';
import { extractUrlClient } from '../../lib/tasks/url';
import { formatDurationLong } from '../../lib/time/format';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { diffCorrections, type DraftFields } from './corrections';
import { radius, spacing } from '../../theme/tokens';
import { type as typeScale } from '../../theme/typography';

type Draft = ParsedTask & { key: string; includeSubtasks: boolean; ai: DraftFields };
type Field = 'space' | 'collection' | 'deadline' | 'estimate' | 'priority';

export function QuickAddSheet() {
  const { colors } = useTheme();
  const open = useUiStore((s) => s.quickAddOpen);
  const setOpen = useUiStore((s) => s.setQuickAddOpen);
  const filter = useUiStore((s) => s.spaceFilter.today);
  const now = useNow();
  const collections = useCollections().data ?? [];
  const createTasks = useCreateTasks();
  const createLinks = useCreateLinks();
  const habits = useHabits({ enabled: open }).data;
  const addVocab = useAddVocab();
  const qc = useQueryClient();

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [editing, setEditing] = useState<{ key: string; field: Field } | null>(null);

  const reset = () => {
    setText('');
    setDrafts([]);
    setUrl(null);
    setFailure(null);
    setEditing(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const analyze = async () => {
    const input = text.trim();
    if (!input || parsing) return;
    setParsing(true);
    setFailure(null);
    try {
      const res = await parseTask(input);
      setDrafts(
        res.tasks.map((t) => ({
          ...t,
          key: newId(),
          includeSubtasks: t.subtasks.length > 0,
          ai: {
            title: t.title,
            space: t.space,
            collection_id: t.collection_id,
            deadline_at: t.deadline_at,
            estimate_minutes: t.estimate_minutes,
          },
        })),
      );
      setSourceText(input);
      setUrl(res.url);
    } catch (e) {
      const msg = errorMessage(e);
      setFailure(e instanceof ApiError && e.code === 'offline' ? `${msg}. ${vi.quickAdd.aiFailed}` : `${msg} ${vi.quickAdd.aiFailed}`);
    } finally {
      setParsing(false);
    }
  };

  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /** "Nhịp hiểu về bạn": remember what the user fixed so the next suggestion is closer. */
  const learnFromEdits = () => {
    if (habits && !habits.learningEnabled) return;
    const name = (id: string | null) => collections.find((c) => c.id === id)?.name ?? null;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';
    const known = (habits?.vocab ?? []).map((v) => v.short);
    const rows: CorrectionRow[] = [];
    const aliases: VocabRow[] = [];
    for (const d of drafts) {
      const r = diffCorrections(drafts.length === 1 ? sourceText : d.ai.title, d.ai, d, { collectionName: name, tz, knownShorts: known });
      rows.push(...r.corrections.map((c) => ({ ...c, id: newId() })));
      if (r.alias && !aliases.some((a) => a.short === r.alias!.short))
        aliases.push(vocabRow(r.alias.short, r.alias.meaning, r.alias.collection_id, 'learned'));
    }
    if (rows.length) void enqueueWrite(qc, 'correctionsCreate', rows).catch(() => undefined);
    if (aliases.length) addVocab.mutate(aliases);
  };

  const save = () => {
    const rows: TaskCreate[] = [];
    const topIds: string[] = [];
    for (const d of drafts) {
      const id = newId();
      topIds.push(id);
      rows.push({
        id,
        title: d.title.trim() || text.trim(),
        space: d.space,
        collection_id: d.collection_id,
        deadline_at: d.deadline_at,
        estimate_minutes: d.estimate_minutes,
        priority: d.priority,
        priority_reason: d.priority_reason || null,
        source: 'quick_add',
      });
      if (d.includeSubtasks) {
        d.subtasks.forEach((s, i) =>
          rows.push({
            id: newId(),
            parent_task_id: id,
            title: s.title,
            space: d.space,
            collection_id: d.collection_id,
            estimate_minutes: s.estimate_minutes,
            priority: d.priority,
            source: 'ai_split',
            sort_order: i,
          }),
        );
      }
    }
    createTasks.mutate(rows);
    learnFromEdits();
    if (url) createLinks.mutate(topIds.map((owner_id) => ({ id: newId(), owner_type: 'task' as const, owner_id, url })));
    showToast(vi.quickAdd.savedCount(topIds.length));
    close();
  };

  /** Fallback: keep the sentence as a task titled with the raw text, tagged "Chưa phân tích". */
  const saveRaw = () => {
    const { url: link, rest } = extractUrlClient(text.trim());
    const id = newId();
    const space = guessSpace(rest) ?? (filter === 'study' ? 'study' : 'work');
    createTasks.mutate([{ id, title: (rest || text.trim()).slice(0, 500), space, source: 'quick_add', needs_parse: true }]);
    if (link) createLinks.mutate([{ id: newId(), owner_type: 'task', owner_id: id, url: link }]);
    showToast(vi.quickAdd.savedCount(1));
    close();
  };

  const openFullForm = () => {
    const title = drafts[0]?.title ?? text.trim();
    close();
    router.push({ pathname: '/task/[id]', params: { id: 'new', title } });
  };

  return (
    <Sheet visible={open} onClose={close} label={vi.quickAdd.title}>
      <View style={[styles.inputRow, { backgroundColor: colors.surface2, borderColor: focused ? colors.primary : colors.border }]}>
        <TextInput
          autoFocus
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (drafts.length) setDrafts([]);
            setFailure(null);
          }}
          placeholder={vi.quickAdd.placeholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          returnKeyType="go"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => void analyze()}
          accessibilityLabel={vi.quickAdd.title}
          style={[typeScale.listTitle, styles.input, { color: colors.textHeading }]}
          maxLength={1000}
        />
      </View>

      {drafts.length === 0 ? (
        <>
          {failure && (
            <AppText variant="secondary" tone="warning" accessibilityRole="alert">
              {failure}
            </AppText>
          )}
          <View style={styles.actions}>
            {failure ? (
              <>
                <Button label={vi.quickAdd.saveRaw} onPress={saveRaw} style={styles.flex} />
                <Button label={vi.states.retry} variant="secondary" onPress={() => void analyze()} />
              </>
            ) : (
              <>
                <Button
                  label={parsing ? vi.quickAdd.analyzing : vi.quickAdd.analyze}
                  variant="ai"
                  loading={parsing}
                  disabled={!text.trim()}
                  onPress={() => void analyze()}
                  style={styles.flex}
                />
                <Button label={vi.quickAdd.fullForm} variant="ghost" onPress={openFullForm} />
              </>
            )}
          </View>
        </>
      ) : (
        <>
          <ScrollView style={styles.previews} contentContainerStyle={styles.previewList} keyboardShouldPersistTaps="handled">
            {url && <Chip label={`${vi.quickAdd.link}: ${url.replace(/^https?:\/\//, '').slice(0, 40)}`} icon="link-outline" />}
            {drafts.map((d) => {
              const isEditing = (f: Field) => editing?.key === d.key && editing.field === f;
              const toggle = (f: Field) => setEditing(isEditing(f) ? null : { key: d.key, field: f });
              const col = collections.find((c) => c.id === d.collection_id);
              return (
                <Card key={d.key} ai>
                  <View style={styles.cardHead}>
                    <AppText variant="meta" tone="primary">
                      {vi.aiMarker}
                    </AppText>
                    {drafts.length > 1 && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={vi.quickAdd.remove}
                        hitSlop={10}
                        onPress={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                      >
                        <Ionicons name="close" size={18} color={colors.textMuted} />
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    value={d.title}
                    onChangeText={(v) => update(d.key, { title: v })}
                    accessibilityLabel={vi.tasks.fields.title}
                    style={[typeScale.listTitle, { color: colors.textHeading }]}
                    selectionColor={colors.primary}
                  />
                  <View style={styles.chips}>
                    <Chip
                      label={vi.spaceFilter[d.space]}
                      tone={d.space}
                      highlight={d.space_uncertain}
                      onPress={() => toggle('space')}
                      accessibilityLabel={
                        d.space_uncertain
                          ? `${vi.quickAdd.checkSpace} ${vi.space[d.space]}`
                          : `${vi.tasks.fields.space}: ${vi.space[d.space]}`
                      }
                    />
                    <Chip label={col?.name ?? vi.quickAdd.noCollection} icon="folder-outline" onPress={() => toggle('collection')} />
                    <Chip label={formatDeadlineShort(d.deadline_at)} icon="flag-outline" onPress={() => toggle('deadline')} />
                    <Chip
                      label={d.estimate_minutes ? formatDurationLong(d.estimate_minutes) : vi.quickAdd.noEstimate}
                      icon="hourglass-outline"
                      onPress={() => toggle('estimate')}
                    />
                    <Chip
                      label={vi.priority[d.priority]}
                      icon={d.priority === 1 ? 'arrow-up-circle' : 'remove-circle-outline'}
                      tone={d.priority === 1 ? 'danger' : 'neutral'}
                      onPress={() => toggle('priority')}
                    />
                    {d.subtasks.length > 0 && (
                      <Chip
                        label={vi.quickAdd.subtasks(d.subtasks.length)}
                        icon={d.includeSubtasks ? 'checkbox' : 'square-outline'}
                        tone="primary"
                        selected={d.includeSubtasks}
                        onPress={() => update(d.key, { includeSubtasks: !d.includeSubtasks })}
                      />
                    )}
                  </View>
                  {d.space_uncertain && !isEditing('space') && (
                    <AppText variant="meta" tone="warning">
                      {vi.quickAdd.checkSpace}
                    </AppText>
                  )}
                  {isEditing('space') && (
                    <SpacePicker
                      value={d.space}
                      onChange={(s) => update(d.key, { space: s, space_uncertain: false, collection_id: null })}
                    />
                  )}
                  {isEditing('collection') && (
                    <CollectionPicker
                      space={d.space}
                      collections={collections}
                      value={d.collection_id}
                      onChange={(id) => update(d.key, { collection_id: id })}
                    />
                  )}
                  {isEditing('deadline') && (
                    <DeadlineEditor value={d.deadline_at} now={now} onChange={(iso) => update(d.key, { deadline_at: iso })} />
                  )}
                  {isEditing('estimate') && (
                    <EstimatePicker value={d.estimate_minutes} onChange={(m) => update(d.key, { estimate_minutes: m })} />
                  )}
                  {isEditing('priority') && <PriorityPicker value={d.priority} onChange={(p) => update(d.key, { priority: p })} />}
                  {d.priority_reason ? (
                    <AppText variant="meta" tone="muted">
                      {d.priority_reason}
                    </AppText>
                  ) : null}
                  {d.includeSubtasks && (
                    <View style={styles.subtasks}>
                      {d.subtasks.map((s, i) => (
                        <AppText key={i} variant="secondary">
                          {`• ${s.title} · ${formatDurationLong(s.estimate_minutes)}`}
                        </AppText>
                      ))}
                    </View>
                  )}
                </Card>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Button label={vi.quickAdd.save} onPress={save} style={styles.flex} disabled={drafts.length === 0} />
            <Button label={vi.quickAdd.fullForm} variant="ghost" onPress={openFullForm} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inputRow: { borderRadius: radius.input, borderWidth: 1, paddingHorizontal: spacing.md },
  input: { minHeight: 52, outlineWidth: 0 },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  previews: { maxHeight: 460 },
  previewList: { gap: spacing.md },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  subtasks: { gap: spacing.xs, paddingLeft: spacing.xs },
});
