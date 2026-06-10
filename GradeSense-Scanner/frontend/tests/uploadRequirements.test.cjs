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
    Number,
    exports: module.exports,
    module,
    require: localRequire,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

const {
  getScanPhaseBlockingIssues,
  getUploadBlockingIssues,
} = loadTsModule('src/utils/uploadRequirements.ts');
const { prepareSessionForScanningPhase } = loadTsModule('src/utils/scanContinuation.ts');

function page(id = 'page-1') {
  return {
    id,
    file_path: `file://${id}.pdf`,
    page_number: 1,
    timestamp: 1,
  };
}

function session(overrides = {}) {
  return {
    session_id: 'local_1',
    session_name: 'Accounts Midterm',
    batch_id: 'batch_1',
    batch_name: '12B',
    subject_id: 'subject_1',
    total_marks: 80,
    exam_date: '2026-06-08',
    created_at: '2026-06-08T00:00:00.000Z',
    status: 'scanning',
    upload_progress: 0,
    settings: {},
    question_paper: { page_count: 0, pages: [] },
    model_answer: { page_count: 0, pages: [] },
    students: [{ id: 'student-1', student_index: 0, label: 'Student #1', page_count: 0, has_blurry_pages: false, pages: [] }],
    stats: { total_students: 0, total_pages: 0, total_size_bytes: 0, blurry_pages: 0 },
    ...overrides,
  };
}

test('final upload still requires student answer documents', () => {
  const draft = session({
    model_answer: { page_count: 1, pages: [page('ma')] },
  });

  assert.deepEqual(Array.from(getUploadBlockingIssues(draft)), ['At least one student answer paper is required.']);
});

test('student scanning can start with uploaded model answer and no student documents yet', () => {
  const draft = session({
    model_answer: { page_count: 1, pages: [page('ma')] },
  });

  assert.deepEqual(Array.from(getScanPhaseBlockingIssues(draft, 'students')), []);
});

test('student scanning blocks until model answer exists', () => {
  assert.deepEqual(
    Array.from(getScanPhaseBlockingIssues(session(), 'students')),
    ['Model Answer is required before scanning student answer papers.']
  );
});

test('preparing student scan appends a new empty slot after existing documents', () => {
  const existing = session({
    students: [
      { id: 'student-1', student_index: 0, label: 'Student #1', page_count: 1, has_blurry_pages: false, pages: [page('s1')] },
    ],
  });

  const prepared = prepareSessionForScanningPhase(existing, 'students', () => 'student-2');

  assert.equal(prepared.studentIndex, 1);
  assert.equal(prepared.session.students.length, 2);
  assert.equal(prepared.session.students[1].id, 'student-2');
  assert.equal(prepared.session.students[1].pages.length, 0);
});
