/* global __dirname */

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
const {
  buildImproveAIRequest,
  normalizeImproveAIResponseScore,
} = loadTsModule('src/utils/improveAI.ts');
const {
  isCompletedGradingJob,
  isFailedGradingJob,
  isReviewReadyExam,
  shouldShowGradingStatus,
} = loadTsModule('src/utils/gradingLifecycle.ts');
const { reconcileFetchedScanSessions } = loadTsModule('src/utils/sessionReconciliation.ts');
const {
  DEFAULT_REVIEW_DENSITY,
  REVIEW_DENSITY_OPTIONS,
  getReviewDensityConfig,
} = loadTsModule('src/utils/reviewDensity.ts');

function buildSession(overrides = {}) {
  return {
    session_id: 'session_1',
    session_name: 'Exam',
    batch_id: 'batch_1',
    batch_name: 'Class 10-A',
    created_at: '2026-06-01T00:00:00.000Z',
    status: 'ready',
    upload_progress: 0,
    settings: {
      auto_capture: true,
      barcode_detection: false,
      blur_detection: false,
      flash_mode: 'off',
      scan_question_paper: true,
      scan_model_answer: true,
      page_mode: 'single',
    },
    question_paper: { page_count: 0, pages: [] },
    model_answer: { page_count: 0, pages: [] },
    students: [],
    stats: {
      total_students: 0,
      total_pages: 0,
      total_size_bytes: 0,
      blurry_pages: 0,
      scanning_duration_seconds: 0,
      avg_time_per_student_seconds: 0,
    },
    ...overrides,
  };
}

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

test('buildImproveAIRequest sends question-level reusable correction context', () => {
  const payload = buildImproveAIRequest(
    {
      id: 'score_1',
      questionNumber: '3',
      obtainedMarks: 4,
      maxMarks: 5,
      questionText: 'Define working capital.',
      aiFeedback: 'Mostly correct.',
      teacherCorrection: null,
      studentAnswerText: 'Current assets minus current liabilities.',
    },
    5,
    '  Give full marks for this definition.  '
  );

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    scoreId: 'score_1',
    questionNumber: '3',
    questionText: 'Define working capital.',
    studentAnswerText: 'Current assets minus current liabilities.',
    aiGrade: 4,
    expectedGrade: 5,
    maxMarks: 5,
    aiFeedback: 'Mostly correct.',
    teacherCorrection: 'Give full marks for this definition.',
    applyToFuture: true,
    applyGlobally: false,
    regradeAll: false,
  });
});

test('normalizeImproveAIResponseScore updates score while preserving local question text', () => {
  const score = normalizeImproveAIResponseScore(
    {
      id: 'score_1',
      questionNumber: '1',
      obtainedMarks: 2,
      maxMarks: 5,
      questionText: 'Original question text',
      aiFeedback: 'Old feedback',
      teacherCorrection: null,
    },
    {
      id: 'score_1',
      obtainedMarks: 4,
      teacherCorrection: 'Corrected rule',
    }
  );

  assert.equal(score.obtainedMarks, 4);
  assert.equal(score.teacherCorrection, 'Corrected rule');
  assert.equal(score.questionText, 'Original question text');
});

test('manage screen does not expose sandbox backdoor controls to teachers', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');

  assert.equal(manageSource.includes('BACKDOOR CONSOLE'), false);
  assert.equal(manageSource.includes('/api/backdoor/seed'), false);
  assert.equal(manageSource.includes('/api/backdoor/reset'), false);
});

test('grading lifecycle ignores completed jobs in home progress section', () => {
  const completedJob = {
    type: 'grade_submissions',
    status: 'completed',
    processedItems: 2,
    totalItems: 2,
  };

  assert.equal(isCompletedGradingJob(completedJob), true);
  assert.equal(shouldShowGradingStatus({ status: 'grading' }, completedJob), false);
  assert.equal(shouldShowGradingStatus({ status: 'syncing' }, null), true);
});

test('grading lifecycle surfaces failed real grading jobs', () => {
  const failedJob = {
    type: 'grade_submissions',
    status: 'failed',
    processedItems: 0,
    totalItems: 3,
  };

  assert.equal(isFailedGradingJob(failedJob), true);
  assert.equal(shouldShowGradingStatus({ status: 'uploaded' }, failedJob), true);
});

test('review-ready exams require completed grading data', () => {
  assert.equal(isReviewReadyExam({ status: 'draft', submissionCount: 2, gradedSubmissionCount: 0 }), false);
  assert.equal(isReviewReadyExam({ status: 'draft', submissionCount: 2, gradedSubmissionCount: 2 }), true);
  assert.equal(isReviewReadyExam({ reviewReady: true, submissionCount: 2, gradedSubmissionCount: 1 }), true);
});

test('grading control opens teacher notes in a dedicated editor modal', () => {
  const panelSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/GradingControlPanel.tsx'),
    'utf8'
  );

  assert.equal(panelSource.includes('TeacherNoteEditorModal'), true);
  assert.equal(panelSource.includes('KeyboardAvoidingView'), false);
});

test('review screen shows source paper files directly and keeps grading controls on rubric tab', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');

  assert.equal(reviewSource.includes('StudentAnswerSheetPanel'), false);
  assert.equal(reviewSource.includes('sheetMode'), false);
  assert.equal(reviewSource.includes("activeTab === 'rubric' && activeScore"), true);
  assert.equal(reviewSource.includes('PaperFileViewer'), true);
});

test('rubric review density defaults compact and reaches review panels', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');
  const rubricSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/RubricReviewPanel.tsx'),
    'utf8'
  );
  const controlSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/ReviewDensityControl.tsx'),
    'utf8'
  );

  assert.equal(DEFAULT_REVIEW_DENSITY, 'compact');
  assert.deepEqual(
    JSON.parse(JSON.stringify(REVIEW_DENSITY_OPTIONS.map(option => option.label))),
    ['A-', 'A', 'A+']
  );
  assert.equal(getReviewDensityConfig('compact').bodyFontSize < getReviewDensityConfig('large').bodyFontSize, true);
  assert.equal(reviewSource.includes('useReviewDensityPreference'), true);
  assert.equal(reviewSource.includes('density={reviewDensity}'), true);
  assert.equal(rubricSource.includes('ReviewDensityControl'), true);
  assert.equal(controlSource.includes('accessibilityState={{ selected: isActive }}'), true);
});

test('paper viewer compares student sheet and model answer in split panes', () => {
  const viewerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/PaperFileViewer.tsx'),
    'utf8'
  );

  assert.equal(viewerSource.includes('CompareDocumentView'), true);
  assert.equal(viewerSource.includes('SplitComparePane'), true);
  assert.equal(viewerSource.includes("group.type === 'student' || group.type === 'model'"), true);
  assert.equal(viewerSource.includes('Open source'), true);
  assert.equal(viewerSource.includes('Refresh link'), true);
  assert.equal(viewerSource.includes('compactWebView'), true);
  assert.equal(viewerSource.includes('ZoomableImagePage'), true);
  assert.equal(viewerSource.includes('Gesture.Pinch()'), true);
  assert.equal(viewerSource.includes('buildZoomableImageHtml'), false);
});

test('session reconciliation drops stale local copies of server-deleted synced sessions', () => {
  const syncedLocal = buildSession({ session_id: 'synced_local', exam_id: 'exam_deleted', status: 'graded' });
  const draftLocal = buildSession({ session_id: 'draft_local', exam_id: undefined, status: 'ready' });
  const fetched = buildSession({ session_id: 'server_session', exam_id: 'exam_live', status: 'graded' });

  const result = reconcileFetchedScanSessions({
    currentSaved: [syncedLocal, draftLocal],
    fetchedSessions: [fetched],
    deletedSessionIds: [],
    recomputeStats: session => session.stats,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(result.savedSessions.map(session => session.session_id).sort())),
    ['draft_local', 'server_session']
  );
});

test('manage screen renders operational tabs without waiting on analytics loader', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');

  assert.equal(manageSource.includes("useState(false)"), true);
  assert.equal(manageSource.includes("useState<'analytics' | 'exams' | 'classroom' | 'brain' | 'reevaluation'>('exams')"), true);
  assert.equal(manageSource.includes('style={styles.segmentScroll}'), false);
  assert.equal(manageSource.includes('contentContainerStyle={styles.segmentContainer}'), false);
  assert.equal(manageSource.includes('minWidth: 0'), true);
});

test('sessions screen exposes a dedicated review-ready exams tab', () => {
  const sessionsSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/sessions.tsx'), 'utf8');

  assert.equal(sessionsSource.includes("useState<'drafts' | 'review' | 'batches'>('review')"), true);
  assert.equal(sessionsSource.includes('loadReviewExams'), true);
  assert.equal(sessionsSource.includes('No exams ready yet'), true);
});

test('insights overview falls back to managed exams when analytics overview is empty', () => {
  const insightsHookSource = fs.readFileSync(path.join(__dirname, '..', 'src/hooks/useInsightsData.ts'), 'utf8');

  assert.equal(insightsHookSource.includes('mergeOverviewWithExams'), true);
  assert.equal(insightsHookSource.includes('buildOverviewFromExams'), true);
  assert.equal(insightsHookSource.includes('fetchManagedExams'), true);
});

test('legacy upload subject selector can create subjects on mobile', () => {
  const uploadSource = fs.readFileSync(path.join(__dirname, '..', 'app/upload.tsx'), 'utf8');

  assert.equal(uploadSource.includes('createSubject'), true);
  assert.equal(uploadSource.includes('Please create one on the webapp'), false);
  assert.equal(uploadSource.includes('handleCreateSubject'), true);
});
