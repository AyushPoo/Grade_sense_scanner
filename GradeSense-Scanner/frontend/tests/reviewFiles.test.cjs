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
  });
  vm.runInContext(transpiled, context, { filename });
  return module.exports;
}

const { buildLocalReviewFiles, buildReviewFileSlides, mergeReviewFiles } = loadTsModule('src/utils/reviewFiles.ts');
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
const {
  normalizeManagedBatches,
  normalizeManagedRosterStudents,
} = loadTsModule('src/utils/manageData.ts');
const { reconcileFetchedScanSessions } = loadTsModule('src/utils/sessionReconciliation.ts');
const {
  DEFAULT_REVIEW_DENSITY,
  REVIEW_DENSITY_OPTIONS,
  getReviewDensityConfig,
} = loadTsModule('src/utils/reviewDensity.ts');
const {
  createImportedPdfPage,
  isPdfScannedPage,
} = loadTsModule('src/utils/scannedPageAssets.ts');

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

test('buildLocalReviewFiles preserves local PDF page metadata for paper viewers', () => {
  const files = buildLocalReviewFiles(
    buildSession({
      model_answer: {
        page_count: 1,
        pages: [
          {
            id: 'model_pdf',
            file_path: 'file:///model.pdf',
            page_number: 1,
            content_type: 'application/pdf',
            original_name: 'model-answer.pdf',
          },
        ],
      },
      students: [
        {
          id: 'student_1',
          label: 'Student #1',
          page_count: 1,
          pages: [
            {
              id: 'student_pdf',
              file_path: 'file:///student.pdf',
              page_number: 1,
              source_type: 'pdf',
              original_name: 'student-answer.pdf',
            },
          ],
        },
      ],
    }),
    null
  );

  const byKind = Object.fromEntries(files.map(file => [file.kind, file]));
  assert.equal(byKind.model_answer.contentType, 'application/pdf');
  assert.equal(byKind.model_answer.originalName, 'model-answer.pdf');
  assert.equal(byKind.answer_sheet.contentType, 'application/pdf');
  assert.equal(byKind.answer_sheet.originalName, 'student-answer.pdf');
});

test('mergeReviewFiles prefers synced API files over stale local files by paper type', () => {
  const files = mergeReviewFiles(
    [
      {
        id: 'api-student',
        kind: 'answer_sheet',
        signedUrl: 'https://api.example/student.pdf',
        annotationSignedUrl: null,
      },
      {
        id: 'api-model',
        kind: 'model_answer',
        signedUrl: 'https://api.example/model.pdf',
        annotationSignedUrl: null,
      },
    ],
    [
      {
        id: 'local-student',
        kind: 'answer_sheet',
        signedUrl: 'file:///stale-student.pdf',
        annotationSignedUrl: null,
      },
      {
        id: 'local-question',
        kind: 'question_paper',
        signedUrl: 'file:///question.pdf',
        annotationSignedUrl: null,
      },
    ]
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(files.map(file => file.id))),
    ['api-student', 'api-model', 'local-question']
  );
});

test('createImportedPdfPage marks selected documents as PDF pages', () => {
  const page = createImportedPdfPage(
    {
      uri: 'file:///cache/student.pdf',
      name: 'student.pdf',
      mimeType: 'application/pdf',
      size: 1234,
    },
    () => 'page_id',
  );

  assert.equal(page.id, 'page_id');
  assert.equal(page.source_type, 'pdf');
  assert.equal(page.content_type, 'application/pdf');
  assert.equal(page.file_size, 1234);
  assert.equal(isPdfScannedPage(page), true);
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

test('grading lifecycle keeps completed jobs visible until review card is shown', () => {
  const completedJob = {
    type: 'grade_submissions',
    status: 'completed',
    processedItems: 2,
    totalItems: 2,
  };

  assert.equal(isCompletedGradingJob(completedJob), true);
  assert.equal(shouldShowGradingStatus({ status: 'grading' }, completedJob), true);
  assert.equal(shouldShowGradingStatus({ status: 'syncing' }, null), true);
});

test('grading lifecycle treats first-paper review pause as active, not complete', () => {
  const job = {
    type: 'grade_submissions',
    status: 'awaiting_first_review',
    processedItems: 1,
    totalItems: 3,
  };

  assert.equal(isCompletedGradingJob(job), false);
  assert.equal(shouldShowGradingStatus({ status: 'grading' }, job), true);
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

test('grading control edits teacher notes inline without opening a separate modal', () => {
  const panelSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/GradingControlPanel.tsx'),
    'utf8'
  );

  assert.equal(panelSource.includes('TextInput'), true);
  assert.equal(panelSource.includes('onChangeText={comment => onCommentChange(activeScore.id, comment)}'), true);
  assert.equal(panelSource.includes('TeacherNoteEditorModal'), false);
  assert.equal(panelSource.includes('KeyboardAvoidingView'), false);
});

test('teacher note editor expands inline while Android owns keyboard resize', () => {
  const panelSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/GradingControlPanel.tsx'),
    'utf8'
  );
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');
  const keyboardLiftSource = fs.readFileSync(path.join(__dirname, '..', 'src/hooks/useKeyboardLift.ts'), 'utf8');

  assert.equal(panelSource.includes('onContentSizeChange'), true);
  assert.equal(panelSource.includes('setNoteContentHeight'), true);
  assert.equal(panelSource.includes('noteHeight >= maxNoteHeight'), true);
  assert.equal(panelSource.includes('commentInputFocused'), false);
  assert.equal(panelSource.includes('height: noteHeight'), true);
  assert.equal(panelSource.includes('keyboardLift'), true);
  assert.equal(panelSource.includes('translateY: -keyboardLift'), true);
  assert.equal(panelSource.includes('scrollEnabled'), true);
  assert.equal(panelSource.includes('multiline'), true);
  assert.equal(panelSource.includes('textAlignVertical="top"'), true);
  assert.equal(keyboardLiftSource.includes('Keyboard.addListener'), true);
  assert.equal(keyboardLiftSource.includes('keyboardDidHide'), true);
  assert.equal(reviewSource.includes("enabled={Platform.OS === 'ios'}"), true);
  assert.equal(reviewSource.includes("behavior={Platform.OS === 'ios' ? 'padding' : undefined}"), true);
  assert.equal(reviewSource.includes('useKeyboardLift'), true);
  assert.equal(reviewSource.includes('keyboardLift={keyboardLift}'), true);
});

test('release metadata uses GradeSense branding and app icons', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  const androidStrings = fs.readFileSync(
    path.join(__dirname, '..', 'android/app/src/main/res/values/strings.xml'),
    'utf8'
  );

  assert.equal(appConfig.expo.name, 'GradeSense');
  assert.equal(appConfig.expo.icon, './assets/images/icon.png');
  assert.equal(appConfig.expo.android.adaptiveIcon.foregroundImage, './assets/images/adaptive-icon.png');
  assert.equal(androidStrings.includes('<string name="app_name">GradeSense</string>'), true);
  assert.equal(androidStrings.includes('GradeSense Scanner'), false);
});

test('portal tab bars use raised floating navigation', () => {
  const teacherTabs = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/_layout.tsx'), 'utf8');
  const studentTabs = fs.readFileSync(path.join(__dirname, '..', 'app/(student)/_layout.tsx'), 'utf8');
  const adminTabs = fs.readFileSync(path.join(__dirname, '..', 'app/(admin)/_layout.tsx'), 'utf8');
  const navSource = fs.readFileSync(path.join(__dirname, '..', 'src/components/navigation/floatingTabBar.ts'), 'utf8');

  for (const source of [teacherTabs, studentTabs, adminTabs]) {
    assert.equal(source.includes('createFloatingTabBarOptions'), true);
    assert.equal(source.includes('floatingTabBarStyles'), false);
  }
  assert.equal(navSource.includes("position: 'absolute'"), true);
  assert.equal(navSource.includes('bottom: Platform.OS ==='), true);
  assert.equal(navSource.includes('borderRadius:'), true);
});

test('rubric feedback is editable and saved with review payload', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');
  const rubricSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/RubricReviewPanel.tsx'),
    'utf8'
  );

  assert.equal(rubricSource.includes('TextInput'), true);
  assert.equal(rubricSource.includes('onFeedbackChange?.(activeScore.id, feedback)'), true);
  assert.equal(rubricSource.includes('value={activeScore.aiFeedback || \'\'}'), true);
  assert.equal(reviewSource.includes('const handleFeedbackChange'), true);
  assert.equal(reviewSource.includes('onFeedbackChange={handleFeedbackChange}'), true);
  assert.equal(reviewSource.includes('scoreId: s.id'), true);
  assert.equal(reviewSource.includes('aiFeedback: s.aiFeedback ?? \'\''), true);
  assert.equal(reviewSource.includes('teacherCorrection: s.teacherCorrection ?? \'\''), true);
});

test('student result feedback prefers teacher corrections before AI comments', () => {
  const studentResultSource = fs.readFileSync(
    path.join(__dirname, '..', 'app/(student)/result-detail.tsx'),
    'utf8'
  );

  assert.equal(studentResultSource.includes('function readQuestionFeedback'), true);
  assert.equal(studentResultSource.indexOf('item.teacherCorrection') < studentResultSource.indexOf('item.feedback ?? item.aiFeedback'), true);
  assert.equal(studentResultSource.includes("feedbackSource === 'teacher' ? 'Teacher feedback' : 'AI feedback'"), true);
});

test('review grading caches active submission details and prefetches the next paper', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');

  assert.equal(reviewSource.includes('detailCacheRef'), true);
  assert.equal(reviewSource.includes('detailRequestRef'), true);
  assert.equal(reviewSource.includes('fetchSubmissionDetail(nextSubmission.id)'), true);
  assert.equal(reviewSource.includes('fetchActiveSubmissionDetail(true)'), true);
});

test('review grading header shows active submission total score and marks', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');

  assert.equal(reviewSource.includes('activeTotalScore'), true);
  assert.equal(reviewSource.includes('activeTotalMarks'), true);
  assert.equal(reviewSource.includes('Score: {formatMarks(activeTotalScore)} / {formatMarks(activeTotalMarks)}'), true);
});

test('home grading polling batches active job requests', () => {
  const homeSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/home.tsx'), 'utf8');

  assert.equal(homeSource.includes('pollingSessions'), true);
  assert.equal(homeSource.includes('Promise.all('), true);
  assert.equal(homeSource.includes('setGradingProgress(prev => {'), true);
});

test('sessions tab keeps cached review and batch content visible while refreshing', () => {
  const sessionsSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/sessions.tsx'), 'utf8');

  assert.equal(sessionsSource.includes("loadingReviewExams && reviewExams.length === 0"), true);
  assert.equal(sessionsSource.includes("loadingBatches && batches.length === 0"), true);
});

test('insights overview fetches analytics and exam fallback in parallel', () => {
  const insightsHookSource = fs.readFileSync(path.join(__dirname, '..', 'src/hooks/useInsightsData.ts'), 'utf8');

  assert.equal(insightsHookSource.includes('const [apiOverview, exams] = await Promise.all'), true);
  assert.equal(insightsHookSource.includes('hasUsableData'), true);
});

test('review screen shows source paper files directly and keeps grading controls on rubric tab', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');

  assert.equal(reviewSource.includes('StudentAnswerSheetPanel'), false);
  assert.equal(reviewSource.includes('sheetMode'), false);
  assert.equal(reviewSource.includes("pointerEvents={activeTab === 'rubric' ? 'auto' : 'none'}"), true);
  assert.equal(reviewSource.includes('{activeScore && ('), true);
  assert.equal(reviewSource.includes('<GradingControlPanel'), true);
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

test('paper viewer persists scroll state when switching review tabs', () => {
  const viewerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/review/PaperFileViewer.tsx'),
    'utf8'
  );
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');

  assert.equal(viewerSource.includes('PaperFileViewerState'), true);
  assert.equal(viewerSource.includes('initialScrollOffset'), true);
  assert.equal(viewerSource.includes('onScrollOffsetChange'), true);
  assert.equal(viewerSource.includes('scrollRef.current?.scrollTo'), true);
  assert.equal(reviewSource.includes('paperViewerState'), true);
  assert.equal(reviewSource.includes('onViewerStateChange={patch => setPaperViewerState'), true);
  assert.equal(reviewSource.includes('contentPager'), true);
  assert.equal(reviewSource.includes("pointerEvents={activeTab === 'sheet' ? 'auto' : 'none'}"), true);
  assert.equal(reviewSource.includes("pointerEvents={activeTab === 'rubric' ? 'auto' : 'none'}"), true);
  assert.equal(reviewSource.includes("activeTab === 'sheet' ? ("), false);
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

test('session reconciliation treats completed linked sessions as server-owned', () => {
  const completedLocal = buildSession({
    session_id: 'completed_local',
    exam_id: 'exam_deleted',
    status: 'completed',
  });

  const result = reconcileFetchedScanSessions({
    currentSaved: [completedLocal],
    fetchedSessions: [],
    deletedSessionIds: [],
    recomputeStats: session => session.stats,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result.savedSessions)), []);
});

test('manage screen renders operational tabs without waiting on analytics loader', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');

  assert.equal(manageSource.includes("useState(false)"), true);
  assert.equal(manageSource.includes("useState<'analytics' | 'exams' | 'classroom' | 'brain' | 'reevaluation'>('exams')"), true);
  assert.equal(manageSource.includes('style={styles.segmentScroll}'), false);
  assert.equal(manageSource.includes('contentContainerStyle={styles.segmentContainer}'), false);
  assert.equal(manageSource.includes('minWidth: 0'), true);
});

test('manage roster derives visible student counts from loaded roster and opens reports', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');
  const reportSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/manage/StudentReportModal.tsx'),
    'utf8'
  );

  assert.equal(manageSource.includes('visibleStudentCount'), true);
  assert.equal(manageSource.includes('setBatches(prev => prev.map(batch => ('), true);
  assert.equal(manageSource.includes('StudentReportModal'), true);
  assert.equal(manageSource.includes('setSelectedStudentReport(std)'), true);
  assert.equal(reportSource.includes('Performance Snapshot'), true);
  assert.equal(reportSource.includes('Subject Performance'), true);
  assert.equal(reportSource.includes('Exam History'), true);
});

test('manage roster normalizes backend batch and student response variants', () => {
  const batches = normalizeManagedBatches({
    batches: [
      { id: 'bat_1', name: '12B', studentCount: 3 },
      { batch_id: 'bat_2', name: '12C', student_count: 2 },
    ],
  });
  const students = normalizeManagedRosterStudents({
    data: {
      students: [
        {
          id: 'std_1',
          name: 'Asha',
          rollNumber: '7',
          average_percentage: 82.25,
          subject_performance: [{ subject_name: 'Accounts', exam_count: 1, average_percentage: 82.25 }],
        },
      ],
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(batches.map(batch => [batch.batch_id, batch.student_count]))), [
    ['bat_1', 3],
    ['bat_2', 2],
  ]);
  assert.equal(students[0].student_id, 'std_1');
  assert.equal(students[0].roll_number, '7');
  assert.equal(students[0].averagePercentage, 82.3);
  assert.equal(students[0].subjectPerformance[0].examsCount, 1);
});

test('review progress and grading completion notifications are wired into mobile review flow', () => {
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'app/review-grading.tsx'), 'utf8');
  const homeSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/home.tsx'), 'utf8');
  const notificationSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/services/gradingNotifications.ts'),
    'utf8'
  );

  assert.equal(reviewSource.includes('gradesense.reviewProgress'), true);
  assert.equal(reviewSource.includes('firstUnreviewedIndex'), true);
  assert.equal(reviewSource.includes('reviewProgressCard'), true);
  assert.equal(notificationSource.includes('scheduleNotificationAsync'), true);
  assert.equal(notificationSource.includes('notifyGradingCompleteOnce'), true);
  assert.equal(notificationSource.includes('notifyGradingProgress'), true);
  assert.equal(notificationSource.includes('completionNotificationInFlight'), true);
  assert.equal(notificationSource.includes('ACTIVE_PROGRESS_KEY'), true);
  assert.equal(homeSource.includes('notifyGradingCompleteOnce'), true);
  assert.equal(homeSource.includes('notifyGradingProgress'), true);
  assert.equal(homeSource.includes('fetchExams().catch'), true);
  assert.equal(homeSource.includes('fetchSessions().catch'), true);
});

test('manage roster edits student profiles through the synced backend', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');
  const reportSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/manage/StudentReportModal.tsx'),
    'utf8'
  );
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'src/api/manage.ts'), 'utf8');

  assert.equal(apiSource.includes('updateBatchStudent'), true);
  assert.equal(apiSource.includes('/api/batches/${batchId}/students/${studentId}'), true);
  assert.equal(manageSource.includes('handleUpdateStudent'), true);
  assert.equal(manageSource.includes('onSaveProfile={handleUpdateStudent}'), true);
  assert.equal(reportSource.includes('onSaveProfile'), true);
  assert.equal(reportSource.includes('mobileNumber'), true);
  assert.equal(reportSource.includes('Student ID'), true);
  assert.equal(reportSource.includes('Save details'), true);
});

test('manage exam delete refreshes scanner sessions so home cannot keep stale exams', () => {
  const manageSource = fs.readFileSync(path.join(__dirname, '..', 'app/(tabs)/manage.tsx'), 'utf8');

  assert.equal(manageSource.includes('const { savedSessions, fetchSessions } = useScanStore();'), true);
  assert.equal(manageSource.includes('await archiveManagedExam'), true);
  assert.equal(manageSource.includes('await fetchSessions();'), true);
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

test('auth login screen uses GradeSense brand assets without scanner copy', () => {
  const loginSource = fs.readFileSync(path.join(__dirname, '..', 'app/(auth)/login.tsx'), 'utf8');

  assert.equal(loginSource.includes("import appIcon from '../../assets/images/icon.png'"), true);
  assert.equal(loginSource.includes('<Image source={appIcon}'), true);
  assert.equal(loginSource.includes('Scanner</Text>'), false);
  assert.equal(loginSource.includes('logoG'), false);
});

test('local Play bundle script uses production endpoints instead of LAN env', () => {
  const buildScript = fs.readFileSync(path.join(__dirname, '..', 'scripts/build-android-local.ps1'), 'utf8');

  assert.equal(buildScript.includes('https://grade-sense-scanner-323601156671.asia-south2.run.app'), true);
  assert.equal(buildScript.includes('https://app.gradesense.in'), true);
  assert.equal(buildScript.includes('192.168.'), false);
  assert.equal(buildScript.includes('.env.local-build-backup'), true);
});
