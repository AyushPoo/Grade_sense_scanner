const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function loadTsModule(relativePath) {
  const filename = path.join(__dirname, '..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  const context = vm.createContext({
    exports: module.exports,
    module,
    require,
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

const { normalizeManagedExams, normalizeManagedRosterStudents, normalizeManagePerformance } = loadTsModule('src/utils/manageData.ts');

test('normalizeManagedExams maps API rows into display-ready exam records', () => {
  const exams = normalizeManagedExams([
    {
      id: 'exam_1',
      name: '  Algebra Test  ',
      batchName: 'Grade 8 A',
      subject_name: 'Math',
      totalMarks: '40',
      status: '',
      results_published: true,
      submission_count: 14,
      average_percentage: 82.25,
    },
  ]);

  assert.equal(exams[0].name, 'Algebra Test');
  assert.equal(exams[0].subjectName, 'Math');
  assert.equal(exams[0].status, 'graded');
  assert.equal(exams[0].resultsPublished, true);
  assert.equal(exams[0].submissionCount, 14);
  assert.equal(exams[0].averagePercentage, 82.3);
});

test('normalizeManagePerformance returns stable empty arrays for partial payloads', () => {
  const performance = normalizeManagePerformance({
    subjectPerformance: [{ subject_name: 'Science', average_percentage: 70, exams_count: 2 }],
  });

  assert.equal(performance.subjectPerformance[0].subjectName, 'Science');
  assert.equal(performance.subjectPerformance[0].averagePercentage, 70);
  assert.deepEqual(JSON.parse(JSON.stringify(performance.studentRankings)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(performance.weakStudents)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(performance.weakQuestions)), []);
});

test('normalizeManagedRosterStudents accepts wrapped roster rows', () => {
  const students = normalizeManagedRosterStudents({
    data: {
      rows: [
        {
          id: 'student_1',
          name: 'Ayush Sudhakar',
          rollNumber: '24012',
          email: 'ayush.24012@ssb.scaler.com',
        },
      ],
    },
  });

  assert.equal(students.length, 1);
  assert.equal(students[0].student_id, 'student_1');
  assert.equal(students[0].rollNumber, '24012');
});
