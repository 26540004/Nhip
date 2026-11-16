/** "Môn học & dự án": create, rename, archive subjects (Học) and projects (Việc). */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { HeaderIconButton } from '../../src/components/HeaderIconButton';
import { QueryState } from '../../src/components/QueryState';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { vi } from '../../src/i18n/vi';
import { newId, useUpsertCollection } from '../../src/lib/api/mutations';
import { useCollections } from '../../src/lib/api/queries';
import type { Collection, Space } from '../../src/lib/api/types';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing, touchTarget } from '../../src/theme/tokens';
import { type as typeScale } from '../../src/theme/typography';

export default function CollectionsScreen() {
  const q = useCollections();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  return (
    <Screen title={vi.collections.title} right={<HeaderIconButton icon="close" label={vi.common.close} onPress={close} />}>
      <QueryState isLoading={q.isLoading} error={q.error} hasData={q.data != null} onRetry={() => void q.refetch()}>
        <Group space="study" items={(q.data ?? []).filter((c) => c.space === 'study')} />
        <Group space="work" items={(q.data ?? []).filter((c) => c.space === 'work')} />
      </QueryState>
    </Screen>
  );
}

function Group({ space, items }: { space: Space; items: Collection[] }) {
  const { colors } = useTheme();
  const upsert = useUpsertCollection();
  const [name, setName] = useState('');
  const kind = space === 'study' ? 'subject' : 'project';
  const add = () => {
    const n = name.trim();
    if (!n) return;
    upsert.mutate({ id: newId(), space, kind, name: n });
    setName('');
  };
  const sorted = [...items].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'vi'));
  return (
    <Card>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: space === 'study' ? colors.study : colors.work }]} />
        <AppText variant="listTitle">{space === 'study' ? vi.collections.subjects : vi.collections.projects}</AppText>
      </View>
      {sorted.length === 0 && (
        <AppText variant="secondary" tone="muted">
          {vi.collections.empty}
        </AppText>
      )}
      {sorted.map((c) => (
        <Row
          key={c.id}
          c={c}
          onRename={(n) => upsert.mutate({ id: c.id, space: c.space, kind: c.kind, name: n })}
          onArchive={() => upsert.mutate({ id: c.id, space: c.space, kind: c.kind, name: c.name, archived: !c.archived })}
        />
      ))}
      <View style={styles.addRow}>
        <View style={styles.flex}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={space === 'study' ? vi.collections.addSubject : vi.collections.addProject}
            onSubmitEditing={add}
            returnKeyType="done"
          />
        </View>
        <Button label={vi.common.add} variant="secondary" onPress={add} disabled={!name.trim()} />
      </View>
    </Card>
  );
}

function Row({ c, onRename, onArchive }: { c: Collection; onRename: (n: string) => void; onArchive: () => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState(c.name);
  return (
    <View style={styles.row}>
      <TextInput
        value={name}
        onChangeText={setName}
        onBlur={() => name.trim() && name.trim() !== c.name && onRename(name.trim())}
        accessibilityLabel={vi.collections.namePlaceholder}
        style={[typeScale.body, styles.flex, { color: c.archived ? colors.textMuted : colors.textHeading }]}
        selectionColor={colors.primary}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={c.archived ? vi.collections.unarchive : vi.collections.archive}
        onPress={onArchive}
        style={styles.icon}
      >
        <Ionicons name={c.archived ? 'arrow-undo-outline' : 'archive-outline'} size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget },
  addRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  icon: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
