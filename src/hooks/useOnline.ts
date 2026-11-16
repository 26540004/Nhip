import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** Current connectivity as seen by TanStack Query's onlineManager. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}
