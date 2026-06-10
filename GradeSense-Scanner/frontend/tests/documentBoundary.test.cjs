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
    Math,
    Number,
    exports: module.exports,
    module,
    require: localRequire,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

const { refineQuadWithBoundaryPoints } = loadTsModule('src/utils/documentBoundary.ts');

function rectangleBoundary(left, top, right, bottom) {
  const points = [];
  for (let x = left; x <= right; x += 40) {
    points.push({ x, y: top });
    points.push({ x, y: bottom });
  }
  for (let y = top; y <= bottom; y += 40) {
    points.push({ x: left, y });
    points.push({ x: right, y });
  }
  return points;
}

test('refines a tight crop outward toward nearby document boundary points', () => {
  const rough = {
    topLeft: { x: 82, y: 90 },
    topRight: { x: 558, y: 92 },
    bottomRight: { x: 552, y: 850 },
    bottomLeft: { x: 86, y: 846 },
  };

  const refined = refineQuadWithBoundaryPoints(
    rough,
    rectangleBoundary(60, 64, 580, 880),
    { width: 640, height: 960 },
  );

  assert.ok(refined.topLeft.x < rough.topLeft.x);
  assert.ok(refined.topLeft.y < rough.topLeft.y);
  assert.ok(refined.topRight.x > rough.topRight.x);
  assert.ok(refined.bottomRight.y > rough.bottomRight.y);
  assert.ok(refined.bottomLeft.x < rough.bottomLeft.x);
});

test('keeps original quad when boundary points would require an unsafe jump', () => {
  const rough = {
    topLeft: { x: 220, y: 250 },
    topRight: { x: 420, y: 250 },
    bottomRight: { x: 420, y: 620 },
    bottomLeft: { x: 220, y: 620 },
  };

  const refined = refineQuadWithBoundaryPoints(
    rough,
    rectangleBoundary(20, 20, 620, 940),
    { width: 640, height: 960 },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(refined)), rough);
});
