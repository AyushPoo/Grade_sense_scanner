export interface ManagedExam {
  id: string;
  name: string;
  batchId: string | null;
  batchName: string;
  subjectId: string | null;
  subjectName: string;
  totalMarks: number;
  examDate: string | null;
  status: string;
  resultsPublished: boolean;
  publishedAt: string | null;
  submissionCount: number;
  gradedSubmissionCount: number;
  reviewReady: boolean;
  averagePercentage: number;
}

export interface ManagedBatch {
  batch_id: string;
  id: string;
  name: string;
  student_count: number;
  studentCount?: number;
  classStandard?: string | null;
  section?: string | null;
  status?: string;
}

export interface SubjectPerformance {
  subjectName: string;
  examsCount: number;
  averagePercentage: number;
}

export interface StudentPerformance {
  studentName: string;
  rollNumber: string;
  examName: string;
  score: number;
  totalMarks: number;
  percentage: number;
}

export interface QuestionPerformance {
  questionNumber: string;
  questionText: string;
  averageScore: number;
  maxMarks: number;
  averagePercentage: number;
  attempts: number;
}

export interface ManagePerformance {
  subjectPerformance: SubjectPerformance[];
  studentRankings: StudentPerformance[];
  weakStudents: StudentPerformance[];
  weakQuestions: QuestionPerformance[];
}

export interface ManagedRosterStudent {
  student_id: string;
  id: string;
  name: string;
  roll_number: string;
  rollNumber?: string;
  email?: string;
  mobile_number?: string;
  mobileNumber?: string;
  averagePercentage?: number;
  examCount?: number;
  subjectPerformance?: SubjectPerformance[];
  strongSubject?: SubjectPerformance | null;
  weakSubject?: SubjectPerformance | null;
  latestExam?: StudentExamHistoryItem | null;
  examHistory?: StudentExamHistoryItem[];
}

export interface StudentExamHistoryItem {
  examId: string;
  examName: string;
  subjectName: string;
  score: number;
  totalMarks: number;
  percentage: number;
  examDate: string | null;
  status: string;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function rounded(value: unknown): number {
  return Math.round(readNumber(value) * 10) / 10;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function readNullableString(value: unknown): string | null {
  const text = readString(value);
  return text || null;
}

function readRows(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  const payload = value as Record<string, unknown>;
  for (const key of keys) {
    const rows = payload[key];
    if (Array.isArray(rows)) return rows;
  }

  const nestedData = payload.data;
  if (Array.isArray(nestedData)) return nestedData;
  if (nestedData && typeof nestedData === 'object') {
    return readRows(nestedData, keys);
  }

  if ('id' in payload || 'batch_id' in payload || 'student_id' in payload || 'studentId' in payload) {
    return [value];
  }

  return [];
}

export function normalizeManagedBatches(rows: unknown): ManagedBatch[] {
  return readRows(rows, ['batches'])
    .map<ManagedBatch | null>(row => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const batchId = readString(item.batch_id ?? item.batchId ?? item.id);
      if (!batchId) return null;
      const studentCount = readNumber(item.student_count ?? item.studentCount);

      return {
        batch_id: batchId,
        id: batchId,
        name: readString(item.name, 'Untitled class') || 'Untitled class',
        student_count: studentCount,
        studentCount,
        classStandard: readNullableString(item.classStandard ?? item.class_standard),
        section: readNullableString(item.section),
        status: readString(item.status, 'active') || 'active',
      };
    })
    .filter((item): item is ManagedBatch => item !== null);
}

export function normalizeManagedExams(rows: unknown): ManagedExam[] {
  const examRows = readRows(rows, ['exams']);

  return examRows
    .map(row => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const id = readString(item.id);
      if (!id) return null;

      return {
        id,
        name: readString(item.name, 'Untitled Exam') || 'Untitled Exam',
        batchId: readNullableString(item.batchId ?? item.batch_id),
        batchName: readString(item.batchName ?? item.batch_name, 'Unassigned class') || 'Unassigned class',
        subjectId: readNullableString(item.subjectId ?? item.subject_id),
        subjectName: readString(item.subjectName ?? item.subject_name, 'Unassigned subject') || 'Unassigned subject',
        totalMarks: readNumber(item.totalMarks ?? item.total_marks),
        examDate: readNullableString(item.examDate ?? item.exam_date),
        status: readString(item.status, 'graded') || 'graded',
        resultsPublished: readBoolean(item.resultsPublished ?? item.results_published),
        publishedAt: readNullableString(item.publishedAt ?? item.published_at),
        submissionCount: readNumber(item.submissionCount ?? item.submission_count),
        gradedSubmissionCount: readNumber(item.gradedSubmissionCount ?? item.graded_submission_count),
        reviewReady: readBoolean(item.reviewReady ?? item.review_ready),
        averagePercentage: rounded(item.averagePercentage ?? item.average_percentage),
      };
    })
    .filter((item): item is ManagedExam => item !== null);
}

export function normalizeManagedRosterStudents(rows: unknown): ManagedRosterStudent[] {
  return readRows(rows, ['students', 'data', 'rows', 'items', 'results'])
    .map<ManagedRosterStudent | null>(row => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const studentId = readString(item.student_id ?? item.studentId ?? item.id ?? item.email);
      if (!studentId) return null;
      const rollNumber = readString(item.roll_number ?? item.rollNumber ?? item.student_roll_number);

      return {
        student_id: studentId,
        id: studentId,
        name: readString(item.name ?? item.studentName ?? item.student_name, 'Unnamed Student') || 'Unnamed Student',
        roll_number: rollNumber,
        rollNumber,
        email: readString(item.email ?? item.studentEmail ?? item.student_email),
        mobile_number: readString(item.mobile_number ?? item.mobileNumber ?? item.phone ?? item.phone_number),
        mobileNumber: readString(item.mobileNumber ?? item.mobile_number ?? item.phone ?? item.phone_number),
        averagePercentage: rounded(item.averagePercentage ?? item.average_percentage),
        examCount: readNumber(item.examCount ?? item.exam_count),
        subjectPerformance: normalizeSubjectPerformance(item.subjectPerformance ?? item.subject_performance),
        strongSubject: normalizeSubjectPerformance([item.strongSubject ?? item.strong_subject])[0] || null,
        weakSubject: normalizeSubjectPerformance([item.weakSubject ?? item.weak_subject])[0] || null,
        latestExam: normalizeStudentExamHistory([item.latestExam ?? item.latest_exam])[0] || null,
        examHistory: normalizeStudentExamHistory(item.examHistory ?? item.exam_history),
      };
    })
    .filter((item): item is ManagedRosterStudent => item !== null);
}

export function normalizeManagePerformance(data: unknown): ManagePerformance {
  const payload = (data || {}) as Record<string, unknown>;

  return {
    subjectPerformance: normalizeSubjectPerformance(payload.subjectPerformance ?? payload.subject_performance),
    studentRankings: normalizeStudentPerformance(payload.studentRankings ?? payload.student_rankings),
    weakStudents: normalizeStudentPerformance(payload.weakStudents ?? payload.weak_students),
    weakQuestions: normalizeQuestionPerformance(payload.weakQuestions ?? payload.weak_questions),
  };
}

function normalizeStudentExamHistory(rows: unknown): StudentExamHistoryItem[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map(row => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const examId = readString(item.examId ?? item.exam_id ?? item.id);
      if (!examId) return null;

      return {
        examId,
        examName: readString(item.examName ?? item.exam_name ?? item.name, 'Untitled Exam') || 'Untitled Exam',
        subjectName: readString(item.subjectName ?? item.subject_name, 'Unassigned subject') || 'Unassigned subject',
        score: readNumber(item.score ?? item.total_score),
        totalMarks: readNumber(item.totalMarks ?? item.total_marks),
        percentage: rounded(item.percentage),
        examDate: readNullableString(item.examDate ?? item.exam_date),
        status: readString(item.status),
      };
    })
    .filter((item): item is StudentExamHistoryItem => item !== null);
}

function normalizeSubjectPerformance(rows: unknown): SubjectPerformance[] {
  if (!Array.isArray(rows)) return [];

  return rows.map(row => {
    if (!row || typeof row !== 'object') {
      return {
        subjectName: 'Unassigned',
        examsCount: 0,
        averagePercentage: 0,
      };
    }
    const item = row as Record<string, unknown>;
    return {
      subjectName: readString(item.subjectName ?? item.subject_name, 'Unassigned') || 'Unassigned',
      examsCount: readNumber(item.examsCount ?? item.exams_count ?? item.examCount ?? item.exam_count),
      averagePercentage: rounded(item.averagePercentage ?? item.average_percentage),
    };
  });
}

function normalizeStudentPerformance(rows: unknown): StudentPerformance[] {
  if (!Array.isArray(rows)) return [];

  return rows.map(row => {
    if (!row || typeof row !== 'object') {
      return {
        studentName: 'Unknown',
        rollNumber: '',
        examName: '',
        score: 0,
        totalMarks: 0,
        percentage: 0,
      };
    }
    const item = row as Record<string, unknown>;
    return {
      studentName: readString(item.studentName ?? item.student_name, 'Unknown') || 'Unknown',
      rollNumber: readString(item.rollNumber ?? item.student_roll_number ?? item.roll_number),
      examName: readString(item.examName ?? item.exam_name),
      score: readNumber(item.score ?? item.total_score),
      totalMarks: readNumber(item.totalMarks ?? item.total_marks),
      percentage: rounded(item.percentage),
    };
  });
}

function normalizeQuestionPerformance(rows: unknown): QuestionPerformance[] {
  if (!Array.isArray(rows)) return [];

  return rows.map(row => {
    if (!row || typeof row !== 'object') {
      return {
        questionNumber: '',
        questionText: '',
        averageScore: 0,
        maxMarks: 0,
        averagePercentage: 0,
        attempts: 0,
      };
    }
    const item = row as Record<string, unknown>;
    return {
      questionNumber: readString(item.questionNumber ?? item.question_number),
      questionText: readString(item.questionText ?? item.question_text),
      averageScore: rounded(item.averageScore ?? item.average_score),
      maxMarks: readNumber(item.maxMarks ?? item.max_marks),
      averagePercentage: rounded(item.averagePercentage ?? item.average_percentage),
      attempts: readNumber(item.attempts),
    };
  });
}
