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
    exports: module.exports,
    module,
    require: localRequire,
    Set,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

const { findReusableDraftSession } = loadTsModule('src/utils/sessionDrafts.ts');

const settings = {
  scan_question_paper: false,
  scan_model_answer: true,
  auto_capture: true,
  auto_crop: false,
  barcode_detection: false,
  blur_detection: false,
  flash_mode: 'auto',
  page_mode: 'single',
  grading_mode: 'balanced',
};

function draft(overrides = {}) {
  return {
    session_id: 'local_123',
    session_name: 'M',
    batch_id: 'batch-1',
    batch_name: '12B',
    subject_id: 'subject-1',
    total_marks: 100,
    exam_date: '2026-06-08',
    status: 'scanning',
    stats: { total_pages: 0, total_students: 0, blurry_pages: 0 },
    settings,
    question_paper: { page_count: 0, pages: [] },
    model_answer: { page_count: 0, pages: [] },
    students: [],
    ...overrides,
  };
}

test('reuses an identical empty local draft instead of creating another one', () => {
  const existing = draft();

  const reusable = findReusableDraftSession([existing], {
    name: 'M',
    batchId: 'batch-1',
    subjectId: 'subject-1',
    totalMarks: 100,
    examDate: '2026-06-08',
    settings,
  });

  assert.equal(reusable, existing);
});

test('does not reuse a draft once pages have been captured', () => {
  const existing = draft({
    stats: { total_pages: 1, total_students: 0, blurry_pages: 0 },
    model_answer: {
      page_count: 1,
      pages: [{ id: 'page-1', file_path: 'file://page.jpg', page_number: 1, timestamp: Date.now() }],
    },
  });

  const reusable = findReusableDraftSession([existing], {
    name: 'M',
    batchId: 'batch-1',
    subjectId: 'subject-1',
    totalMarks: 100,
    examDate: '2026-06-08',
    settings,
  });

  assert.equal(reusable, null);
});

test('does not reuse a draft for a different subject or scan shape', () => {
  const existing = draft();

  assert.equal(findReusableDraftSession([existing], {
    name: 'M',
    batchId: 'batch-1',
    subjectId: 'subject-2',
    totalMarks: 100,
    examDate: '2026-06-08',
    settings,
  }), null);

  assert.equal(findReusableDraftSession([existing], {
    name: 'M',
    batchId: 'batch-1',
    subjectId: 'subject-1',
    totalMarks: 100,
    examDate: '2026-06-08',
    settings: { ...settings, scan_question_paper: true },
  }), null);
});
