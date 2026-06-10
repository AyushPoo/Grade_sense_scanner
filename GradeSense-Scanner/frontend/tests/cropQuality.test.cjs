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

const { evaluateAutoCropCandidate } = loadTsModule('src/utils/cropQuality.ts');

const dims = { width: 640, height: 960 };

test('accepts a large portrait document with mild perspective', () => {
  const result = evaluateAutoCropCandidate({
    topLeft: { x: 74, y: 82 },
    topRight: { x: 568, y: 102 },
    bottomRight: { x: 548, y: 878 },
    bottomLeft: { x: 82, y: 856 },
  }, dims, { confidence: 0.72, areaScore: 0.84 });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, undefined);
});

test('rejects a thin text band mistaken for a page', () => {
  const result = evaluateAutoCropCandidate({
    topLeft: { x: 90, y: 190 },
    topRight: { x: 580, y: 205 },
    bottomRight: { x: 565, y: 255 },
    bottomLeft: { x: 80, y: 245 },
  }, dims, { confidence: 0.8, areaScore: 0.5 });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'area_too_small');
});

test('rejects crossed diagonal corner ordering', () => {
  const result = evaluateAutoCropCandidate({
    topLeft: { x: 92, y: 120 },
    topRight: { x: 548, y: 820 },
    bottomRight: { x: 560, y: 132 },
    bottomLeft: { x: 84, y: 828 },
  }, dims, { confidence: 0.8, areaScore: 0.8 });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'non_convex');
});

test('rejects extreme perspective that would warp into an uncomfortable crop', () => {
  const result = evaluateAutoCropCandidate({
    topLeft: { x: 206, y: 120 },
    topRight: { x: 450, y: 126 },
    bottomRight: { x: 610, y: 870 },
    bottomLeft: { x: 42, y: 856 },
  }, dims, { confidence: 0.8, areaScore: 0.8 });

  assert.equal(result.accepted, false);
  assert.match(result.reason, /edge_ratio|angle_outlier|diagonal_ratio/);
});

test('rejects low confidence detections even when the shape looks plausible', () => {
  const result = evaluateAutoCropCandidate({
    topLeft: { x: 74, y: 82 },
    topRight: { x: 568, y: 102 },
    bottomRight: { x: 548, y: 878 },
    bottomLeft: { x: 82, y: 856 },
  }, dims, { confidence: 0.32, areaScore: 0.84 });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low_confidence');
});

test('rejects frame-hugging background borders mistaken for a document', () => {
  const result = evaluateAutoCropCandidate({
    topLeft: { x: 0, y: 210 },
    topRight: { x: 640, y: 214 },
    bottomRight: { x: 633, y: 522 },
    bottomLeft: { x: 0, y: 650 },
  }, dims, { confidence: 0.82, areaScore: 0.7 });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'border_hugging');
});
