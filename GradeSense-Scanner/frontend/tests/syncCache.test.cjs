/* global __dirname */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function loadTsModule(relativePath, moduleCache = new Map()) {
  const filename = path.join(__dirname, '..', relativePath);
  if (moduleCache.has(filename)) {
    return moduleCache.get(filename).exports;
  }

  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(filename, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const resolved = path.join(path.dirname(relativePath), specifier);
      const normalized = resolved.replace(/\\/g, '/');
      const tsRelative = normalized.endsWith('.ts') ? normalized : `${normalized}.ts`;
      return loadTsModule(tsRelative, moduleCache);
    }
    return require(specifier);
  };
  const context = vm.createContext({
    Date,
    Error,
    JSON,
    Map,
    Promise,
    exports: module.exports,
    module,
    require: localRequire,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

function createMemoryStorage() {
  const values = new Map();
  return {
    values,
    async getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

async function setup() {
  const cache = new Map();
  const syncCache = loadTsModule('src/services/sync/syncCache.ts', cache);
  const swr = loadTsModule('src/services/sync/staleWhileRevalidate.ts', cache);
  const storage = createMemoryStorage();
  syncCache.configureSyncCacheStorage(storage);
  syncCache.clearMemorySyncCache();
  swr.clearInFlightCachedQueries();
  return { syncCache, swr, storage };
}

test('cached query returns stale data immediately while refresh continues', async () => {
  const { syncCache, swr } = await setup();
  const now = Date.now();
  await syncCache.writeSyncCache('review-ready', ['old'], {
    staleMs: 10,
    cacheMs: 1000 * 60,
    now: now - 100,
  });

  let resolveFetch;
  const refresh = new Promise(resolve => { resolveFetch = resolve; });
  const result = await swr.readCachedQuery({
    key: 'review-ready',
    staleMs: 10,
    cacheMs: 1000,
    fetcher: () => refresh,
  });

  assert.deepEqual(result.data, ['old']);
  assert.equal(result.fromCache, true);
  assert.equal(Boolean(result.refreshPromise && typeof result.refreshPromise.then === 'function'), true);

  resolveFetch(['new']);
  assert.deepEqual(await result.refreshPromise, ['new']);

  const cached = await syncCache.readSyncCache('review-ready');
  assert.deepEqual(cached.entry.data, ['new']);
});

test('concurrent empty-cache reads dedupe into one network request', async () => {
  const { swr } = await setup();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { exams: 2 };
  };

  const [first, second] = await Promise.all([
    swr.readCachedQuery({ key: 'managed-exams', staleMs: 60000, cacheMs: 300000, fetcher }),
    swr.readCachedQuery({ key: 'managed-exams', staleMs: 60000, cacheMs: 300000, fetcher }),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first.data, { exams: 2 });
  assert.deepEqual(second.data, { exams: 2 });
});

test('failed background refresh keeps the last cached data', async () => {
  const { syncCache, swr } = await setup();
  const now = Date.now();
  await syncCache.writeSyncCache('batches', [{ name: 'Class 10-A' }], {
    staleMs: 1,
    cacheMs: 1000 * 60,
    now: now - 100,
  });

  const result = await swr.readCachedQuery({
    key: 'batches',
    staleMs: 1,
    cacheMs: 1000,
    fetcher: async () => {
      throw new Error('network down');
    },
  });

  assert.deepEqual(result.data, [{ name: 'Class 10-A' }]);
  await assert.rejects(result.refreshPromise, /network down/);

  const cached = await syncCache.readSyncCache('batches');
  assert.deepEqual(cached.entry.data, [{ name: 'Class 10-A' }]);
});
