import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { registerMutationDefaults } from './mutations';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep cached data for a week so Today / Tasks / Notes are readable offline.
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: 2,
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Paused while offline, persisted, replayed when the connection returns.
      networkMode: 'online',
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: 3,
    },
  },
});

registerMutationDefaults(queryClient);

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'nhip-query-cache-v1',
  throttleTime: 1000,
});

/** Bump to invalidate persisted caches after a breaking data-shape change. */
export const QUERY_CACHE_BUSTER = 'v2';

// Online/offline from NetInfo on native (the browser's own events are used on web).
if (Platform.OS !== 'web') {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false)),
  );
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
    return () => sub.remove();
  });
}
