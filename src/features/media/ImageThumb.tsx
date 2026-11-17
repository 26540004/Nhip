/** An image attachment: thumbnail with the photo's aspect ratio; tap opens the full-screen viewer. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { vi } from '../../i18n/vi';
import type { Attachment, ImageMeta } from '../../lib/api/types';
import { useMediaQueue } from '../../lib/media/queue';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import { useMediaUri } from './useMediaUri';

export function ImageThumb({
  attachment,
  maxHeight = 360,
  onLongPress,
}: {
  attachment: Attachment;
  maxHeight?: number;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  const meta = attachment.meta_json as unknown as Partial<ImageMeta>;
  const thumbUri = useMediaUri(meta.thumb_path ?? attachment.storage_path);
  const fullLocal = useMediaQueue((s) => (attachment.storage_path ? s.local[attachment.storage_path] : undefined));
  const uploading = useMediaQueue((s) => s.jobs.some((j) => j.path === attachment.storage_path));
  const [failed, setFailed] = useState(false);
  const ratio = meta.width && meta.height ? meta.width / meta.height : 4 / 3;
  // Prefer the sharper local full image when it is on this device.
  const uri = fullLocal ?? thumbUri;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={vi.media.openImage}
      onPress={() => router.push({ pathname: '/viewer', params: { owner: attachment.owner_id, id: attachment.id } })}
      onLongPress={onLongPress}
      style={[styles.frame, { aspectRatio: ratio, maxHeight, backgroundColor: colors.surface2, borderColor: colors.border }]}
    >
      {uri && !failed ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="image-outline" size={28} color={colors.textMuted} />
        </View>
      )}
      {uploading && (
        <View style={[styles.badge, { backgroundColor: 'rgba(14,17,22,0.75)' }]}>
          <Ionicons name="cloud-upload-outline" size={14} color={colors.textHeading} />
          <AppText variant="meta" tone="heading">
            {vi.media.imageUploading}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: radius.card, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, alignSelf: 'center' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.chip,
  },
});
