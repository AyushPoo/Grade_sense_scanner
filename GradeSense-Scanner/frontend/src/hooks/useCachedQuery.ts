import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { configureSyncCacheStorage } from '../services/sync/syncCache';
import { readCachedQuery } from '../services/sync/staleWhileRevalidate';

configureSyncCacheStorage(AsyncStorage);

interface UseCachedQueryOptions<T> {
  key: string;
  enabled?: boolean;
  staleMs: number;
  cacheMs: number;
  fetcher: () => Promise<T>;
}

export interface UseCachedQueryResult<T> {
  data: T | null;
  error: Error | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  refresh: () => Promise<T | null>;
  setCachedData: (updater: T | ((current: T | null) => T)) => void;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value || 'Request failed'));
}

export function useCachedQuery<T>({
  key,
  enabled = true,
  staleMs,
  cacheMs,
  fetcher,
}: UseCachedQueryOptions<T>): UseCachedQueryResult<T> {
  const fetcherRef = useRef(fetcher);
  const dataRef = useRef<T | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(async (forceRefresh = false) => {
    if (!enabled) {
      setIsInitialLoading(false);
      setIsRefreshing(false);
      return null;
    }

    let isMounted = true;
    setError(null);
    setIsInitialLoading(current => current && !dataRef.current);

    try {
      const result = await readCachedQuery<T>({
        key,
        staleMs,
        cacheMs,
        forceRefresh,
        fetcher: () => fetcherRef.current(),
      });

      if (!isMounted) return result.data;
      setData(result.data);
      setIsStale(result.isStale);
      setIsInitialLoading(false);

      if (result.refreshPromise) {
        setIsRefreshing(true);
        result.refreshPromise
          .then(fresh => {
            if (!isMounted) return;
            setData(fresh);
            setIsStale(false);
          })
          .catch(err => {
            if (!isMounted) return;
            setError(toError(err));
          })
          .finally(() => {
            if (isMounted) setIsRefreshing(false);
          });
      } else {
        setIsRefreshing(false);
      }

      return result.data;
    } catch (err) {
      if (isMounted) {
        setError(toError(err));
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
      return null;
    }
  }, [cacheMs, enabled, key, staleMs]);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (cancelled) return;
      await load(false);
    };
    start();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => load(true), [load]);

  const setCachedData = useCallback((updater: T | ((current: T | null) => T)) => {
    setData(current => (
      typeof updater === 'function'
        ? (updater as (current: T | null) => T)(current)
        : updater
    ));
  }, []);

  return {
    data,
    error,
    isInitialLoading,
    isRefreshing,
    isStale,
    refresh,
    setCachedData,
  };
}
