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
    Array,
    Error,
    Map,
    Math,
    Number,
    Promise,
    exports: module.exports,
    module,
    require: localRequire,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

const { mapWithConcurrency } = loadTsModule('src/utils/concurrency.ts');

test('mapWithConcurrency preserves order and never exceeds the limit', async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async item => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return item * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(maxActive, 2);
});
