/**
 * Plays a recording stored as several segments as if it were one file: a single player
 * loads the segment that contains the requested position and moves on to the next one when
 * a segment ends. Positions are seconds from the start of the whole recording.
 */
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioSegment } from '../../lib/api/types';
import { locate, totalDuration } from '../../lib/media/recording';
import { useRecorderStore } from '../record/store';
import { useResolveMedia } from './useMediaUri';

const RATES = [1, 1.25, 1.5, 2];

export function useSegmentPlayer(segments: readonly AudioSegment[], fallbackDurationSec = 0) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const resolve = useResolveMedia();
  const sorted = useMemo(() => [...segments].sort((a, b) => a.seq - b.seq), [segments]);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const [unavailable, setUnavailable] = useState(false);
  const pendingSeek = useRef<{ offset: number; play: boolean } | null>(null);

  const duration = Math.max(totalDuration(sorted), fallbackDurationSec);
  const position = loaded != null && sorted[loaded] ? Number(sorted[loaded].start_offset_sec) + (status.currentTime || 0) : pos;

  const load = useCallback(
    async (index: number, offset: number, play: boolean) => {
      const seg = sorted[index];
      if (!seg) return;
      const uri = await resolve(seg.storage_path);
      if (!uri) {
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      // Playback must not reconfigure the session while a recording is running.
      if (!useRecorderStore.getState().session) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
      }
      pendingSeek.current = { offset, play };
      player.replace({ uri });
      setLoaded(index);
    },
    [sorted, resolve, player],
  );

  // Apply the requested offset once the new source is ready.
  useEffect(() => {
    if (!status.isLoaded || !pendingSeek.current) return;
    const { offset, play } = pendingSeek.current;
    pendingSeek.current = null;
    void player.seekTo(offset).then(() => {
      player.setPlaybackRate(rate);
      if (play) player.play();
    });
  }, [status.isLoaded, status.duration, loaded, player, rate]);

  // Continue into the next segment when one finishes.
  const next = useRef({ loaded, count: sorted.length, load });
  useEffect(() => {
    next.current = { loaded, count: sorted.length, load };
  }, [loaded, sorted.length, load]);
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s: { didJustFinish?: boolean }) => {
      const n = next.current;
      if (s.didJustFinish && n.loaded != null && n.loaded + 1 < n.count) void n.load(n.loaded + 1, 0, true);
    });
    return () => sub.remove();
  }, [player]);

  const seek = useCallback(
    (t: number, play?: boolean) => {
      const target = Math.max(0, Math.min(t, duration || t));
      const loc = locate(sorted, target);
      setPos(target);
      if (!loc) return;
      const shouldPlay = play ?? status.playing;
      if (loaded === loc.index && status.isLoaded) {
        void player.seekTo(loc.offset).then(() => shouldPlay && player.play());
      } else void load(loc.index, loc.offset, shouldPlay);
    },
    [sorted, duration, loaded, status.isLoaded, status.playing, player, load],
  );

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (loaded == null || !status.isLoaded) {
      const start = pos >= duration - 0.5 ? 0 : pos;
      const loc = locate(sorted, start);
      if (loc) void load(loc.index, loc.offset, true);
      return;
    }
    player.play();
  }, [status.playing, status.isLoaded, loaded, pos, duration, sorted, load, player]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    player.setPlaybackRate(next);
  }, [rate, player]);

  return { position, duration, playing: status.playing, buffering: status.isBuffering, rate, unavailable, seek, toggle, cycleRate };
}
