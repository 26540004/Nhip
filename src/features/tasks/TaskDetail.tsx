/**
 * Task detail / full form. Used as a route (/task/[id]) on phones and as the right pane on
 * wide screens. `taskId === 'new'` renders the create form.
 * Existing tasks save field-by-field (optimistic, offline-queued).
 */
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import {
  CollectionPicker,
  DeadlineEditor,
  EstimatePicker,
  formatDeadlineShort,
  PriorityPicker,
  SpacePicker,
} from '../../components/FieldEditors';
import { errorMessage } from '../../components/QueryState';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { useNow } from '../../hooks/useNow';
import { useStartPlan } from '../plan/useStartPlan';
import { vi } from '../../i18n/vi';
import { confirmDestructive } from '../../lib/confirm';
import { parseTask } from '../../lib/api/functions';
import {
  completionPatch,
  newId,
  type TaskCreate,
  type TaskPatch,
  useCreateLinks,
  useCreateTasks,
  useDeleteLink,
  useDeleteTask,
  useUpdateTask,
} from '../../lib/api/mutations';
import { useCollections, useLinks, useTaskBlocks, useTasks } from '../../lib/api/queries';
import type { Priority, Space, Task } from '../../lib/api/types';
import { subtasksOf } from '../../lib/tasks/grouping';
import { domainOf, extractUrlClient } from '../../lib/tasks/url';
import { formatDayHeader, formatDurationLong, formatTimeRange } from '../../lib/time/format';
import { dateKeyOf } from '../../lib/time/tz';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing, touchTarget } from '../../theme/tokens';
import { type as typeScale } from '../../theme/typography';

type Field = 'space' | 'collection' | 'deadline' | 'estimate' | 'priority';

export function TaskDetail({ taskId, initialTitle, onClose }: { taskId: string; initialTitle?: string; onClose: () => void }) {
  const isNew = taskId === 'new';
  const tasksQ = useTasks();
  const existing = tasksQ.data?.find((t) => t.id === taskId) ?? null;

  if (!isNew && !existing) {
    return (
      <View style={styles.center}>
        <AppText variant="body" tone="muted">
          {tasksQ.isLoading ? vi.states.loading : vi.common.notFound}
        </AppText>
        <Button label={vi.common.back} variant="secondary" onPress={onClose} />
      </View>
    );
  }
  return isNew ? (
    <NewTaskForm initialTitle={initialTitle ?? ''} onClose={onClose} />
  ) : (
    <ExistingTask
      // Remount when synced text fields change elsewhere (e.g. AI re-parse) so local inputs reset.
      key={`${existing!.id}:${existing!.title}:${existing!.description ?? ''}:${existing!.actual_minutes ?? ''}`}
      task={existing!}
      allTasks={tasksQ.data ?? []}
      onClose={onClose}
    />
  );
}

// ---------------------------------------------------------------------------

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <AppText variant="meta" tone="muted">
          {title.toUpperCase()}
        </AppText>
        {right}
      </View>
      {children}
    </View>
  );
}

/** A tappable summary line that expands into an editor. */
function FieldRow({
  label,
  value,
  open,
  onToggle,
  children,
  highlight,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.fieldRow}
      >
        <AppText variant="secondary" tone="muted">
          {label}
        </AppText>
        <View style={styles.inline}>
          <AppText variant="body" tone={highlight ? 'warning' : 'heading'} numeric>
            {value}
          </AppText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </Pressable>
      {open && <View style={styles.editor}>{children}</View>}
    </View>
  );
}

function useFieldToggle() {
  const [open, setOpen] = useState<Field | null>(null);
  return { open, toggle: (f: Field) => setOpen((cur) => (cur === f ? null : f)) };
}

// ---------------------------------------------------------------------------

function NewTaskForm({ initialTitle, onClose }: { initialTitle: string; onClose: () => void }) {
  const now = useNow();
  const collections = useCollections().data ?? [];
  const create = useCreateTasks();
  const createLinks = useCreateLinks();
  const { open, toggle } = useFieldToggle();
  const initial = extractUrlClient(initialTitle);
  const [title, setTitle] = useState(initial.rest);
  const [description, setDescription] = useState('');
  const [space, setSpace] = useState<Space>('study');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [priority, setPriority] = useState<Priority>(2);

  const save = () => {
    if (!title.trim()) return;
    const id = newId();
    create.mutate([
      {
        id,
        title: title.trim(),
        description: description.trim() || null,
        space,
        collection_id: collectionId,
        deadline_at: deadline,
        estimate_minutes: estimate,
        priority,
        source: 'form',
      },
    ]);
    if (initial.url) createLinks.mutate([{ id: newId(), owner_type: 'task', owner_id: id, url: initial.url }]);
    showToast(vi.quickAdd.savedCount(1));
    onClose();
  };

  const col = collections.find((c) => c.id === collectionId);
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AppText variant="section" accessibilityRole="header">
        {vi.tasks.newTask}
      </AppText>
      <TextField label={vi.tasks.fields.title} value={title} onChangeText={setTitle} autoFocus={!initialTitle} returnKeyType="next" />
      <TextField label={vi.tasks.fields.description} value={description} onChangeText={setDescription} multiline />
      <Card>
        <FieldRow label={vi.tasks.fields.space} value={vi.space[space]} open={open === 'space'} onToggle={() => toggle('space')}>
          <SpacePicker
            value={space}
            onChange={(s) => {
              setSpace(s);
              setCollectionId(null);
            }}
          />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.collection}
          value={col?.name ?? vi.quickAdd.noCollection}
          open={open === 'collection'}
          onToggle={() => toggle('collection')}
        >
          <CollectionPicker space={space} collections={collections} value={collectionId} onChange={setCollectionId} />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.deadline}
          value={formatDeadlineShort(deadline)}
          open={open === 'deadline'}
          onToggle={() => toggle('deadline')}
        >
          <DeadlineEditor value={deadline} now={now} onChange={setDeadline} />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.estimate}
          value={estimate ? formatDurationLong(estimate) : vi.quickAdd.noEstimate}
          open={open === 'estimate'}
          onToggle={() => toggle('estimate')}
        >
          <EstimatePicker value={estimate} onChange={setEstimate} />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.priority}
          value={vi.priority[priority]}
          open={open === 'priority'}
          onToggle={() => toggle('priority')}
        >
          <PriorityPicker value={priority} onChange={setPriority} />
        </FieldRow>
      </Card>
      <View style={styles.row}>
        <Button label={vi.common.save} onPress={save} disabled={!title.trim()} style={styles.flex} />
        <Button label={vi.common.cancel} variant="secondary" onPress={onClose} />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

function ExistingTask({ task, allTasks, onClose }: { task: Task; allTasks: Task[]; onClose: () => void }) {
  const { colors } = useTheme();
  const now = useNow();
  const collections = useCollections().data ?? [];
  const update = useUpdateTask();
  const del = useDeleteTask();
  const createTasks = useCreateTasks();
  const blocks = useTaskBlocks(task.id).data ?? [];
  const links = useLinks(task.id).data ?? [];
  const createLinks = useCreateLinks();
  const deleteLink = useDeleteLink(task.id);
  const { open, toggle } = useFieldToggle();
  const plan = useStartPlan();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [newSub, setNewSub] = useState('');
  const [newLink, setNewLink] = useState('');
  const [actual, setActual] = useState(task.actual_minutes ? String(task.actual_minutes) : '');
  const [reparsing, setReparsing] = useState(false);

  const patch = (p: TaskPatch) => update.mutate({ id: task.id, patch: p });
  const subtasks = subtasksOf(allTasks, task.id);
  const col = collections.find((c) => c.id === task.collection_id);
  const done = task.status === 'done';

  const addSubtask = () => {
    const t = newSub.trim();
    if (!t) return;
    const row: TaskCreate = {
      id: newId(),
      parent_task_id: task.id,
      title: t,
      space: task.space,
      collection_id: task.collection_id,
      priority: task.priority,
      sort_order: subtasks.length,
    };
    createTasks.mutate([row]);
    setNewSub('');
  };

  const moveSub = (index: number, dir: -1 | 1) => {
    const other = subtasks[index + dir];
    const cur = subtasks[index];
    if (!other || !cur) return;
    update.mutate({ id: cur.id, patch: { sort_order: index + dir } });
    update.mutate({ id: other.id, patch: { sort_order: index } });
  };

  const addLink = () => {
    const { url } = extractUrlClient(newLink.trim());
    const finalUrl = url ?? (/^[\w-]+(\.[\w-]+)+/.test(newLink.trim()) ? `https://${newLink.trim()}` : null);
    if (!finalUrl) return;
    createLinks.mutate([{ id: newId(), owner_type: 'task', owner_id: task.id, url: finalUrl }]);
    setNewLink('');
  };

  const reparse = async () => {
    setReparsing(true);
    try {
      const res = await parseTask(task.title);
      const first = res.tasks[0];
      if (first) {
        patch({
          title: first.title,
          space: first.space,
          collection_id: first.collection_id,
          deadline_at: first.deadline_at,
          estimate_minutes: first.estimate_minutes,
          priority: first.priority,
          priority_reason: first.priority_reason || null,
          needs_parse: false,
        });
      }
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setReparsing(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDestructive(vi.common.confirmDelete))) return;
    del.mutate(task.id);
    onClose();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.titleRow}>
        <Checkbox
          checked={done}
          onChange={(v) => patch(completionPatch(v))}
          label={done ? vi.tasks.markTodo : vi.tasks.markDone}
          color={colors.success}
        />
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={() => title.trim() && title.trim() !== task.title && patch({ title: title.trim() })}
          multiline
          accessibilityLabel={vi.tasks.fields.title}
          style={[typeScale.section, styles.flex, { color: colors.textHeading }, done && styles.strike]}
          selectionColor={colors.primary}
        />
      </View>

      {task.needs_parse && (
        <Card>
          <AppText variant="secondary" tone="warning">
            {vi.quickAdd.unparsedTag}
          </AppText>
          <Button label={vi.tasks.unparsedRetry} variant="ai" loading={reparsing} onPress={() => void reparse()} />
        </Card>
      )}

      <Card>
        <FieldRow label={vi.tasks.fields.space} value={vi.space[task.space]} open={open === 'space'} onToggle={() => toggle('space')}>
          <SpacePicker value={task.space} onChange={(s) => patch({ space: s, collection_id: null })} />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.collection}
          value={col?.name ?? vi.quickAdd.noCollection}
          open={open === 'collection'}
          onToggle={() => toggle('collection')}
        >
          <CollectionPicker
            space={task.space}
            collections={collections}
            value={task.collection_id}
            onChange={(id) => patch({ collection_id: id })}
          />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.deadline}
          value={formatDeadlineShort(task.deadline_at)}
          highlight={!done && task.deadline_at != null && Date.parse(task.deadline_at) < now}
          open={open === 'deadline'}
          onToggle={() => toggle('deadline')}
        >
          <DeadlineEditor value={task.deadline_at} now={now} onChange={(iso) => patch({ deadline_at: iso })} />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.estimate}
          value={task.estimate_minutes ? formatDurationLong(task.estimate_minutes) : vi.quickAdd.noEstimate}
          open={open === 'estimate'}
          onToggle={() => toggle('estimate')}
        >
          <EstimatePicker value={task.estimate_minutes} onChange={(m) => patch({ estimate_minutes: m })} />
        </FieldRow>
        <FieldRow
          label={vi.tasks.fields.priority}
          value={vi.priority[task.priority]}
          open={open === 'priority'}
          onToggle={() => toggle('priority')}
        >
          <PriorityPicker value={task.priority} onChange={(p) => patch({ priority: p })} />
        </FieldRow>
        {task.priority_reason ? (
          <View style={styles.inline}>
            {(task.source === 'quick_add' || task.source === 'ai_split') && (
              <AppText variant="meta" tone="primary">
                {vi.aiMarker}
              </AppText>
            )}
            <AppText variant="secondary" tone="muted" style={styles.flex}>
              {`${vi.tasks.aiReason}: ${task.priority_reason}`}
            </AppText>
          </View>
        ) : null}
      </Card>

      {!done && (
        <Button
          label={plan.busy ? vi.aiPlan.working : vi.aiPlan.scheduleThis}
          variant="ai"
          loading={plan.busy}
          onPress={() => void plan.start({ task_ids: [task.id] })}
        />
      )}

      <TextField
        label={vi.tasks.fields.description}
        value={description}
        onChangeText={setDescription}
        onBlur={() => (description.trim() || null) !== task.description && patch({ description: description.trim() || null })}
        multiline
      />

      <Section title={vi.tasks.fields.subtasks}>
        {subtasks.map((s, i) => (
          <View key={s.id} style={styles.subRow}>
            <Checkbox
              checked={s.status === 'done'}
              onChange={(v) => update.mutate({ id: s.id, patch: completionPatch(v) })}
              label={s.title}
              color={colors.success}
            />
            <View style={styles.flex}>
              <AppText
                variant="body"
                tone={s.status === 'done' ? 'muted' : 'heading'}
                style={s.status === 'done' ? styles.strike : undefined}
              >
                {s.title}
              </AppText>
              {s.estimate_minutes ? (
                <AppText variant="meta" tone="muted" numeric>
                  {formatDurationLong(s.estimate_minutes)}
                </AppText>
              ) : null}
            </View>
            <IconBtn icon="arrow-up" label={vi.common.moveUp} disabled={i === 0} onPress={() => moveSub(i, -1)} />
            <IconBtn icon="arrow-down" label={vi.common.moveDown} disabled={i === subtasks.length - 1} onPress={() => moveSub(i, 1)} />
            <IconBtn icon="trash-outline" label={vi.common.delete} onPress={() => del.mutate(s.id)} />
          </View>
        ))}
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField
              value={newSub}
              onChangeText={setNewSub}
              placeholder={vi.tasks.subtaskPlaceholder}
              onSubmitEditing={addSubtask}
              returnKeyType="done"
            />
          </View>
          <Button label={vi.common.add} variant="secondary" onPress={addSubtask} disabled={!newSub.trim()} />
        </View>
      </Section>

      <Section title={vi.tasks.fields.links}>
        {links.map((l) => (
          <View key={l.id} style={[styles.linkRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={l.url ?? ''}
              style={styles.flex}
              onPress={() => l.url && void WebBrowser.openBrowserAsync(l.url)}
            >
              <AppText variant="body" tone="heading" numberOfLines={1}>
                {l.title ?? domainOf(l.url ?? '')}
              </AppText>
              <AppText variant="meta" tone="muted" numberOfLines={1}>
                {domainOf(l.url ?? '')}
              </AppText>
            </Pressable>
            <IconBtn icon="close" label={vi.common.delete} onPress={() => deleteLink.mutate(l.id)} />
          </View>
        ))}
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField
              value={newLink}
              onChangeText={setNewLink}
              placeholder="https://…"
              autoCapitalize="none"
              keyboardType="url"
              onSubmitEditing={addLink}
            />
          </View>
          <Button label={vi.common.add} variant="secondary" onPress={addLink} disabled={!newLink.trim()} />
        </View>
      </Section>

      <Section title={vi.tasks.fields.blocks}>
        {blocks.length === 0 ? (
          <AppText variant="secondary" tone="muted">
            {vi.tasks.noBlocks}
          </AppText>
        ) : (
          blocks.map((b) => {
            const s = Date.parse(b.start_at);
            const e = Date.parse(b.end_at);
            return (
              <View key={b.id} style={styles.blockRow}>
                <Ionicons
                  name={b.status === 'synced' ? 'checkmark-circle' : b.status === 'conflict' ? 'alert-circle' : 'ellipse-outline'}
                  size={16}
                  color={b.status === 'synced' ? colors.success : b.status === 'conflict' ? colors.danger : colors.textMuted}
                />
                <AppText variant="secondary" numeric style={styles.flex}>
                  {`${formatDayHeader(dateKeyOf(s))} · ${formatTimeRange(s, e)}`}
                </AppText>
                <AppText variant="meta" tone="muted">
                  {vi.tasks.blockStatus[b.status] ?? b.status}
                </AppText>
              </View>
            );
          })
        )}
      </Section>

      {done && (
        <TextField
          label={vi.tasks.fields.actual}
          value={actual}
          onChangeText={(v) => setActual(v.replace(/[^\d]/g, ''))}
          onBlur={() => {
            const n = actual ? Number(actual) : null;
            if (n !== task.actual_minutes) patch({ actual_minutes: n });
          }}
          keyboardType="number-pad"
          hint={vi.duration.minutes(Number(actual || 0))}
        />
      )}

      <Button
        label={vi.tasks.deleteTask}
        variant="ghost"
        onPress={() => void remove()}
        icon={<Ionicons name="trash-outline" size={18} color={colors.danger} />}
      />
    </ScrollView>
  );
}

function IconBtn({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconBtn, { opacity: disabled ? 0.3 : 1 }]}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldWrap: { gap: spacing.sm },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: touchTarget },
  editor: { paddingBottom: spacing.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.input,
    paddingLeft: spacing.md,
    minHeight: touchTarget + 8,
  },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  strike: { textDecorationLine: 'line-through' },
});
