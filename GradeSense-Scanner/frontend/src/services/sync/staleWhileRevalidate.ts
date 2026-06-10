import { readSyncCache, removeSyncCache, writeSyncCache } from './syncCache';

export interface CachedQueryOptions<T> {
  key: string;
  fetcher: () => Promise<T>;
  staleMs: number;
  cacheMs: number;
  forceRefresh?: boolean;
}

export interface CachedQueryResult<T> {
  data: T | null;
  fromCache: boolean;
  isStale: boolean;
  refreshPromise: Promise<T> | null;
}

const inFlightRefreshes = new Map<string, Promise<unknown>>();

export function clearInFlightCachedQueries() {
  inFlightRefreshes.clear();
}

export async function refreshCachedQuery<T>({
  key,
  fetcher,
  staleMs,
  cacheMs,
}: CachedQueryOptions<T>): Promise<T> {
  const existing = inFlightRefreshes.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const request = fetcher()
    .then(async data => {
      await writeSyncCache(key, data, { staleMs, cacheMs });
      return data;
    })
    .finally(() => {
      inFlightRefreshes.delete(key);
    });

  inFlightRefreshes.set(key, request);
  return request;
}

export async function readCachedQuery<T>(options: CachedQueryOptions<T>): Promise<CachedQueryResult<T>> {
  const cached = await readSyncCache<T>(options.key);

  if (cached) {
    const shouldRefresh = options.forceRefresh || cached.isStale;
    return {
      data: cached.entry.data,
      fromCache: true,
      isStale: cached.isStale,
      refreshPromise: shouldRefresh ? refreshCachedQuery(options) : null,
    };
  }

  const data = await refreshCachedQuery(options);
  return {
    data,
    fromCache: false,
    isStale: false,
    refreshPromise: null,
  };
}

export async function invalidateCachedQuery(key: string): Promise<void> {
  clearInFlightCachedQueries();
  await removeSyncCache(key);
}
