export interface StudentDashboardStats {
  totalExams: number;
  avgPercentage: number;
  rank: string;
  improvement: number;
}

export interface StudentRecentResult {
  submissionId: string;
  examId: string;
  examName: string;
  subject: string;
  score: string;
  percentage: number;
  status: string;
  date: string | null;
}

export interface StudentSubjectPerformance {
  subject: string;
  average: number;
  exams: number;
}

export interface StudentQuestionArea {
  question: string;
  score: string;
  feedback: string | null;
  submissionId: string;
  questionNumber: string;
}

export interface StudentDashboardData {
  stats: StudentDashboardStats;
  recentResults: StudentRecentResult[];
  subjectPerformance: StudentSubjectPerformance[];
  recommendations: string[];
  weakAreas: StudentQuestionArea[];
  strongAreas: StudentQuestionArea[];
}

export interface StudentSubmissionSummary {
  id: string;
  examId: string;
  studentName: string | null;
  status: string;
  totalScore: number;
  totalMarks: number;
  percentage: number;
  teacherFeedback: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNullableString(value: unknown): string | null {
  const text = readString(value);
  return text || null;
}

function readNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function rounded(value: unknown): number {
  return Math.round(readNumber(value) * 10) / 10;
}

function normalizeAreaRows(rows: unknown): StudentQuestionArea[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const item = objectValue(row);
    return {
      question: readString(item.question, 'Question') || 'Question',
      score: readString(item.score),
      feedback: readNullableString(item.feedback),
      submissionId: readString(item.submissionId ?? item.submission_id),
      questionNumber: readString(item.questionNumber ?? item.question_number),
    };
  });
}

export function normalizeStudentDashboard(payload: unknown): StudentDashboardData {
  const data = objectValue(payload);
  const stats = objectValue(data.stats);
  const recentRows = data.recentResults ?? data.recent_results;
  const subjectRows = data.subjectPerformance ?? data.subject_performance;

  return {
    stats: {
      totalExams: readNumber(stats.totalExams ?? stats.total_exams),
      avgPercentage: rounded(stats.avgPercentage ?? stats.avg_percentage),
      rank: readString(stats.rank, 'N/A') || 'N/A',
      improvement: rounded(stats.improvement),
    },
    recentResults: Array.isArray(recentRows)
      ? recentRows.map((row: unknown) => {
        const item = objectValue(row);
        return {
          submissionId: readString(item.submissionId ?? item.submission_id),
          examId: readString(item.examId ?? item.exam_id),
          examName: readString(item.examName ?? item.exam_name, 'Exam') || 'Exam',
          subject: readString(item.subject, 'General') || 'General',
          score: readString(item.score),
          percentage: rounded(item.percentage),
          status: readString(item.status, 'published') || 'published',
          date: readNullableString(item.date),
        };
      }).filter(row => row.submissionId)
      : [],
    subjectPerformance: Array.isArray(subjectRows)
      ? subjectRows.map((row: unknown) => {
        const item = objectValue(row);
        return {
          subject: readString(item.subject, 'General') || 'General',
          average: rounded(item.average),
          exams: readNumber(item.exams),
        };
      })
      : [],
    recommendations: Array.isArray(data.recommendations)
      ? data.recommendations.map(item => readString(item)).filter(Boolean)
      : [],
    weakAreas: normalizeAreaRows(data.weakAreas ?? data.weak_areas),
    strongAreas: normalizeAreaRows(data.strongAreas ?? data.strong_areas),
  };
}

export function normalizeStudentSubmissions(rows: unknown): StudentSubmissionSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const item = objectValue(row);
    const id = readString(item.id);
    if (!id) return null;
    return {
      id,
      examId: readString(item.examId ?? item.exam_id),
      studentName: readNullableString(item.studentName ?? item.student_name),
      status: readString(item.status, 'published') || 'published',
      totalScore: readNumber(item.totalScore ?? item.total_score),
      totalMarks: readNumber(item.totalMarks ?? item.total_marks),
      percentage: rounded(item.percentage),
      teacherFeedback: readNullableString(item.teacherFeedback ?? item.teacher_feedback),
      publishedAt: readNullableString(item.publishedAt ?? item.published_at),
      updatedAt: readNullableString(item.updatedAt ?? item.updated_at),
    };
  }).filter((item): item is StudentSubmissionSummary => item !== null);
}
