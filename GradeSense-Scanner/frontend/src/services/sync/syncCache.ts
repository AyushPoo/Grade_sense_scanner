export interface SyncCacheEntry<T> {
  data: T;
  updatedAt: number;
  staleAt: number;
  expiresAt: number;
}

export interface SyncCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SyncCacheWriteOptions {
  staleMs: number;
  cacheMs: number;
  now?: number;
}

export interface SyncCacheRead<T> {
  entry: SyncCacheEntry<T>;
  isStale: boolean;
  source: 'memory' | 'storage';
}

const CACHE_PREFIX = 'gradesense.sync.';

let persistentStorage: SyncCacheStorage | null = null;
const memoryCache = new Map<string, SyncCacheEntry<unknown>>();

function storageKey(key: string) {
  return `${CACHE_PREFIX}${key}`;
}

function isEntry(value: unknown): value is SyncCacheEntry<unknown> {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SyncCacheEntry<unknown>>;
  return (
    'data' in entry
    && typeof entry.updatedAt === 'number'
    && typeof entry.staleAt === 'number'
    && typeof entry.expiresAt === 'number'
  );
}

export function configureSyncCacheStorage(storage: SyncCacheStorage | null) {
  persistentStorage = storage;
}

export function clearMemorySyncCache() {
  memoryCache.clear();
}

export async function readSyncCache<T>(key: string, now = Date.now()): Promise<SyncCacheRead<T> | null> {
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > now) {
      return {
        entry: memoryEntry as SyncCacheEntry<T>,
        isStale: memoryEntry.staleAt <= now,
        source: 'memory',
      };
    }
    memoryCache.delete(key);
  }

  if (!persistentStorage) return null;

  try {
    const raw = await persistentStorage.getItem(storageKey(key));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!isEntry(parsed)) {
      await persistentStorage.removeItem(storageKey(key));
      return null;
    }

    if (parsed.expiresAt <= now) {
      memoryCache.delete(key);
      await persistentStorage.removeItem(storageKey(key));
      return null;
    }

    memoryCache.set(key, parsed);
    return {
      entry: parsed as SyncCacheEntry<T>,
      isStale: parsed.staleAt <= now,
      source: 'storage',
    };
  } catch {
    return null;
  }
}

export async function writeSyncCache<T>(
  key: string,
  data: T,
  { staleMs, cacheMs, now = Date.now() }: SyncCacheWriteOptions
): Promise<SyncCacheEntry<T>> {
  const boundedCacheMs = Math.max(cacheMs, staleMs);
  const entry: SyncCacheEntry<T> = {
    data,
    updatedAt: now,
    staleAt: now + staleMs,
    expiresAt: now + boundedCacheMs,
  };

  memoryCache.set(key, entry);

  if (persistentStorage) {
    try {
      await persistentStorage.setItem(storageKey(key), JSON.stringify(entry));
    } catch {
      // Memory cache still gives the current app session instant navigation.
    }
  }

  return entry;
}

export async function removeSyncCache(key: string): Promise<void> {
  memoryCache.delete(key);
  if (!persistentStorage) return;
  try {
    await persistentStorage.removeItem(storageKey(key));
  } catch {
    // Best effort invalidation; network refresh can still replace memory state.
  }
}
