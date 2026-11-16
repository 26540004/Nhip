/**
 * Notes — "Ghi chú". Pinned first; card shows title, first lines, space chip, collection and
 * attachment icons. ≥ 768 px: list + editor side by side.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import { QueryState } from '../../components/QueryState';
import { SpaceFilterControl } from '../../components/SpaceFilterControl';
import { useResponsive } from '../../hooks/useResponsive';
import { vi } from '../../i18n/vi';
import { newId, usePendingSyncCount, useCreateNote } from '../../lib/api/mutations';
import { type NoteListItem, useCollections, useNotes } from '../../lib/api/queries';
import { previewOf } from '../../lib/notes/checklist';
import { dateKeyOf } from '../../lib/time/tz';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { NoteEditor } from './NoteEditor';

const ATTACHMENT_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  image: 'image-outline',
  link: 'link-outline',
  audio: 'mic-outline',
  file: 'document-outline',
};

/** "16/11" in the app timezone. */
function shortDate(iso: string): string {
  const [, m, d] = dateKeyOf(Date.parse(iso)).split('-');
  return `${d}/${m}`;
}

export function NotesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useResponsive();
  const split = mode !== 'phone';
  const space = useUiStore((s) => s.spaceFilter.notes);
  const notesQ = useNotes();
  const collections = useCollections().data ?? [];
  const create = useCreateNote();
  const pending = usePendingSyncCount();
  const [selected, setSelected] = useState<string | null>(null);

  const notes = useMemo(() => (notesQ.data ?? []).filter((n) => space === 'all' || n.space === space), [notesQ.data, space]);

  const open = (id: string) => (split ? setSelected(id) : router.push({ pathname: '/note/[id]', params: { id } }));
  const createNote = () => {
    const id = newId();
    create.mutate({ id, space: space === 'all' ? 'study' : space, title: '' });
    open(id);
  };

  const renderCard = (n: NoteListItem) => {
    const col = collections.find((c) => c.id === n.collection_id);
    const preview = previewOf(n.plain_text);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[n.pinned ? vi.notes.pinned : null, n.title || vi.notes.untitled, preview].filter(Boolean).join(', ')}
        onPress={() => open(n.id)}
        style={[styles.card, { backgroundColor: selected === n.id ? colors.surface2 : colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.cardHead}>
          {n.pinned && <Ionicons name="pin" size={14} color={colors.primary} />}
          <AppText variant="listTitle" numberOfLines={1} style={styles.flex}>
            {n.title || vi.notes.untitled}
          </AppText>
          <AppText variant="meta" tone="muted" numeric>
            {shortDate(n.updated_at)}
          </AppText>
        </View>
        {preview ? (
          <AppText variant="secondary" tone="muted" numberOfLines={2}>
            {preview}
          </AppText>
        ) : null}
        <View style={styles.cardFoot}>
          <Chip label={vi.spaceFilter[n.space]} tone={n.space} />
          {col && (
            <AppText variant="meta" tone="muted" numberOfLines={1} style={styles.flex}>
              {col.name}
            </AppText>
          )}
          <View style={styles.icons}>
            {(n.attachment_types ?? []).map((t) => (
              <Ionicons key={t} name={ATTACHMENT_ICON[t] ?? 'attach'} size={14} color={colors.textMuted} />
            ))}
          </View>
        </View>
      </Pressable>
    );
  };

  const list = (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <AppText variant="screenTitle" accessibilityRole="header">
          {vi.tabs.notes}
        </AppText>
        <View style={styles.inline}>
          {pending > 0 && <Chip label={`${vi.states.pendingSync} · ${pending}`} icon="cloud-upload-outline" tone="warning" />}
          <HeaderIconButton icon="search" label={vi.search.placeholder} onPress={() => router.push('/search')} />
          <HeaderIconButton icon="create-outline" label={vi.notes.newNote} onPress={createNote} />
        </View>
      </View>
      <View style={styles.controls}>
        <SpaceFilterControl screen="notes" />
      </View>
      <QueryState isLoading={notesQ.isLoading} error={notesQ.error} hasData={notesQ.data != null} onRetry={() => void notesQ.refetch()}>
        {notes.length === 0 ? (
          <EmptyState icon="document-text-outline" title={vi.notes.empty} actionLabel={vi.notes.newNote} onAction={createNote} />
        ) : (
          <FlashList
            data={notes}
            keyExtractor={(n) => n.id}
            onRefresh={() => void notesQ.refetch()}
            refreshing={notesQ.isRefetching}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
            ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
            renderItem={({ item }) => renderCard(item)}
          />
        )}
      </QueryState>
    </View>
  );

  if (!split) return <View style={[styles.flex, { backgroundColor: colors.bg }]}>{list}</View>;
  return (
    <View style={[styles.split, { backgroundColor: colors.bg }]}>
      <View style={[styles.listPane, { borderRightColor: colors.border }]}>{list}</View>
      <View style={[styles.flex, { paddingTop: insets.top + spacing.sm }]}>
        {selected ? (
          <NoteEditor key={selected} noteId={selected} onClose={() => setSelected(null)} />
        ) : (
          <EmptyState icon="document-text-outline" title={vi.tabs.notes} actionLabel={vi.notes.newNote} onAction={createNote} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  listPane: { width: 420, borderRightWidth: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  card: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icons: { flexDirection: 'row', gap: spacing.xs, marginLeft: 'auto' },
});
