import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useUiStore } from '../stores/ui';

const GO_TARGETS: Record<string, '/' | '/tasks' | '/notes' | '/calendar'> = {
  t: '/',
  v: '/tasks',
  n: '/notes',
  l: '/calendar',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Web shortcuts (spec §F): N = quick add, / = search, G then T/V/N/L = go to section, Esc = close sheet.
 * "/" = search.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let pendingG = 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useUiStore.getState().setQuickAddOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();

      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const target = GO_TARGETS[key];
        if (target) {
          e.preventDefault();
          router.navigate(target);
        }
        return;
      }
      if (key === 'g') {
        pendingG = Date.now();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        router.push('/search');
        return;
      }
      if (key === 'n') {
        e.preventDefault();
        useUiStore.getState().setQuickAddOpen(true);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
