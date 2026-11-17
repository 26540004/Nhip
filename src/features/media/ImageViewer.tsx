/**
 * /viewer?owner=<ownerId>&id=<attachmentId> — full-screen image with pinch-zoom, pan and
 * double-tap; swipe between the owner's images with the arrows (or ← / → on web).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { vi } from '../../i18n/vi';
import { useAttachments } from '../../lib/api/queries';
import type { Attachment } from '../../lib/api/types';
import { spacing, touchTarget } from '../../theme/tokens';
import { useMediaUri } from './useMediaUri';

const MAX_SCALE = 5;

export function ImageViewer() {
  const { owner, id } = useLocalSearchParams<{ owner: string; id: string }>();
  const insets = useSafeAreaInsets();
  const images = (useAttachments(owner).data ?? []).filter((a) => a.type === 'image');
  const [current, setCurrent] = useState(id);
  const index = Math.max(
    0,
    images.findIndex((a) => a.id === current),
  );
  const img = images[index];
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const go = (d: number) => {
    const next = images[index + d];
    if (next) setCurrent(next.id);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <View style={styles.root}>
      {img ? <Zoomable key={img.id} attachment={img} /> : null}
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel={vi.media.closeViewer} onPress={close} style={styles.btn}>
          <Ionicons name="close" size={28} color="#F2F4F7" />
        </Pressable>
        {images.length > 1 && (
          <AppText variant="secondary" style={styles.light} numeric>
            {index + 1}/{images.length}
          </AppText>
        )}
      </View>
      {images.length > 1 && (
        <View style={[styles.nav, { bottom: insets.bottom + spacing.lg }]} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={vi.common.back}
            disabled={index === 0}
            onPress={() => go(-1)}
            style={[styles.btn, index === 0 && styles.dim]}
          >
            <Ionicons name="chevron-back" size={28} color="#F2F4F7" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={vi.common.moveDown}
            disabled={index >= images.length - 1}
            onPress={() => go(1)}
            style={[styles.btn, index >= images.length - 1 && styles.dim]}
          >
            <Ionicons name="chevron-forward" size={28} color="#F2F4F7" />
          </Pressable>
        </View>
      )}
      <AppText variant="meta" style={[styles.hint, { bottom: insets.bottom + spacing.xs }]}>
        {vi.media.zoomHint}
      </AppText>
    </View>
  );
}

function Zoomable({ attachment }: { attachment: Attachment }) {
  const thumb = useMediaUri(typeof attachment.meta_json?.thumb_path === 'string' ? attachment.meta_json.thumb_path : null);
  const full = useMediaUri(attachment.storage_path);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      startScale.value = scale.value;
    },
    onUpdate: (e) => {
      'worklet';
      scale.value = Math.min(MAX_SCALE, Math.max(1, startScale.value * e.scale));
    },
    onDeactivate: () => {
      'worklet';
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
    },
  });
  const pan = usePanGesture({
    minPointers: 1,
    onActivate: () => {
      'worklet';
      startX.value = tx.value;
      startY.value = ty.value;
    },
    onUpdate: (e) => {
      'worklet';
      if (scale.value <= 1) return;
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: () => {
      'worklet';
      const zoomed = scale.value > 1.05;
      scale.value = withTiming(zoomed ? 1 : 2.5);
      if (zoomed) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
    },
  });
  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  const uri = full ?? thumb;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, style]}>
        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  nav: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', justifyContent: 'space-between' },
  btn: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dim: { opacity: 0.3 },
  light: { color: '#F2F4F7' },
  hint: { position: 'absolute', alignSelf: 'center', color: 'rgba(242,244,247,0.6)' },
});
