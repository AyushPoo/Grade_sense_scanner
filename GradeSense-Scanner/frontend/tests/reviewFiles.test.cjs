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

const { buildLocalReviewFiles, buildReviewFileSlides } = loadTsModule('src/utils/reviewFiles.ts');
const { normalizeReviewScores } = loadTsModule('src/utils/reviewScores.ts');
const {
  buildReviewSettingsPayload,
  normalizeReviewSettings,
  REVIEW_GRADING_MODES,
  REVIEW_DIFFICULTIES,
} = loadTsModule('src/utils/reviewSettings.ts');

test('buildReviewFileSlides orders document types without mutating signed urls', () => {
  const slides = buildReviewFileSlides(
    [
      {
        id: 'student-file',
        kind: 'answer_sheet',
        contentType: 'application/pdf',
        signedUrl: 'https://cdn.example/student.pdf?X-Amz-Signature=old',
        annotationSignedUrl: null,
      },
      {
        id: 'qp-file',
        fileType: 'question_paper',
        contentType: 'application/pdf',
        signedUrl: 'https://cdn.example/question.pdf',
        annotationSignedUrl: null,
      },
      {
        id: 'model-file',
        kind: 'model_answer',
        signedUrl: null,
        annotationSignedUrl: null,
      },
    ],
    42
  );

  assert.deepEqual(
    slides.map(slide => ({ id: slide.id, title: slide.title })),
    [
      { id: 'qp-file', title: 'Question Paper' },
      { id: 'model-file', title: 'Model Answer' },
      { id: 'student-file', title: 'Student Sheet' },
    ]
  );
  assert.equal(slides[0].signedUrl, 'https://cdn.example/question.pdf');
  assert.equal(slides[0].contentType, 'application/pdf');
  assert.equal(slides[1].signedUrl, null);
  assert.equal(
    slides[2].signedUrl,
    'https://cdn.example/student.pdf?X-Amz-Signature=old'
  );
});

test('buildLocalReviewFiles maps local session question, model, and active student pages', () => {
  const files = buildLocalReviewFiles(
    {
      session_id: 'session_1',
      exam_id: 'exam_1',
      question_paper: {
        pages: [
          { id: 'qp_1', file_path: 'file:///qp-1.jpg', page_number: 1 },
        ],
      },
      model_answer: {
        pages: [
          { id: 'model_1', file_path: 'file:///model-1.jpg', page_number: 1 },
        ],
      },
      students: [
        {
          id: 'student_1',
          name: 'Asha Rao',
          roll_number: '12',
          pages: [
            { id: 'student_page_1', file_path: 'file:///student-1.jpg', page_number: 1 },
          ],
        },
        {
          id: 'student_2',
          name: 'Other Student',
          roll_number: '13',
          pages: [
            { id: 'student_page_2', file_path: 'file:///student-2.jpg', page_number: 1 },
          ],
        },
      ],
    },
    { studentName: 'Asha Rao', studentRollNumber: '12' }
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(files.map(file => ({ id: file.id, kind: file.kind, signedUrl: file.signedUrl })))),
    [
      { id: 'local-question-qp_1', kind: 'question_paper', signedUrl: 'file:///qp-1.jpg' },
      { id: 'local-model-model_1', kind: 'model_answer', signedUrl: 'file:///model-1.jpg' },
      { id: 'local-student-student_page_1', kind: 'answer_sheet', signedUrl: 'file:///student-1.jpg' },
    ]
  );
});

test('normalizeReviewScores preserves extracted student answer text from existing API fields', () => {
  const scores = normalizeReviewScores([
    {
      id: 'score_1',
      question_number: '2',
      obtained_marks: 3,
      max_marks: 5,
      question_text: 'Explain photosynthesis.',
      ai_feedback: 'Partially correct.',
      teacher_correction: null,
      student_answer_text: 'Plants make food with sunlight but I missed chlorophyll.',
    },
  ]);

  assert.equal(scores[0].studentAnswerText, 'Plants make food with sunlight but I missed chlorophyll.');
  assert.equal(scores[0].questionNumber, '2');
  assert.equal(scores[0].obtainedMarks, 3);
});

test('normalizeReviewSettings returns complete webapp review settings from partial API data', () => {
  const settings = normalizeReviewSettings({
    grading_mode: 'strict',
    feedback_enabled: false,
    custom_instructions: 'Focus on working.',
  });

  assert.equal(settings.gradingMode, 'strict');
  assert.equal(settings.feedbackEnabled, false);
  assert.equal(settings.difficulty, 'medium');
  assert.equal(settings.customInstructions, 'Focus on working.');
  assert.deepEqual(
    JSON.parse(JSON.stringify(REVIEW_GRADING_MODES.map(mode => mode.value))),
    ['balanced', 'strict', 'lenient', 'conceptual']
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(REVIEW_DIFFICULTIES.map(difficulty => difficulty.value))),
    ['medium', 'easy', 'hard']
  );
});

test('buildReviewSettingsPayload trims instructions for API writes', () => {
  const payload = buildReviewSettingsPayload(normalizeReviewSettings({
    gradingMode: 'lenient',
    customInstructions: '  Award process marks.  ',
  }));

  assert.equal(payload.gradingMode, 'lenient');
  assert.equal(payload.customInstructions, 'Award process marks.');
});

test('manage screen does not expose sandbox backdoor controls to teachers', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');

  assert.equal(manageSource.includes('BACKDOOR CONSOLE'), false);
  assert.equal(manageSource.includes('/api/backdoor/seed'), false);
  assert.equal(manageSource.includes('/api/backdoor/reset'), false);
});
