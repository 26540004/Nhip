import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

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
      networkMode: 'offlineFirst',
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'nhip-query-cache-v1',
  throttleTime: 1000,
});

/** Bump to invalidate persisted caches after a breaking data-shape change. */
export const QUERY_CACHE_BUSTER = 'v1';
