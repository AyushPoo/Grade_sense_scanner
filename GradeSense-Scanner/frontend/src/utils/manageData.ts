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

export function normalizeManagedExams(rows: unknown): ManagedExam[] {
  if (!Array.isArray(rows)) return [];

  return rows
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

export function normalizeManagePerformance(data: unknown): ManagePerformance {
  const payload = (data || {}) as Record<string, unknown>;

  return {
    subjectPerformance: normalizeSubjectPerformance(payload.subjectPerformance ?? payload.subject_performance),
    studentRankings: normalizeStudentPerformance(payload.studentRankings ?? payload.student_rankings),
    weakStudents: normalizeStudentPerformance(payload.weakStudents ?? payload.weak_students),
    weakQuestions: normalizeQuestionPerformance(payload.weakQuestions ?? payload.weak_questions),
  };
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
      examsCount: readNumber(item.examsCount ?? item.exams_count),
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
