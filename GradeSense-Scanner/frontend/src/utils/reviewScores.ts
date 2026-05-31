import type { ScoreItem } from '../types/review';

type RawScoreItem = Partial<ScoreItem> & {
  question_number?: string | number | null;
  obtained_marks?: number | string | null;
  max_marks?: number | string | null;
  question_text?: string | null;
  ai_feedback?: string | null;
  teacher_correction?: string | null;
  student_answer_text?: string | null;
  student_answer?: string | null;
  extracted_answer?: string | null;
  extracted_text?: string | null;
};

export function normalizeReviewScores(rawScores: RawScoreItem[]): ScoreItem[] {
  return rawScores.map(score => ({
    id: String(score.id || ''),
    questionNumber: String(score.questionNumber || score.question_number || ''),
    obtainedMarks: Number(score.obtainedMarks ?? score.obtained_marks ?? 0),
    maxMarks: Number(score.maxMarks ?? score.max_marks ?? 0),
    questionText: String(score.questionText || score.question_text || ''),
    aiFeedback: score.aiFeedback ?? score.ai_feedback ?? null,
    teacherCorrection: score.teacherCorrection ?? score.teacher_correction ?? null,
    studentAnswerText: getStudentAnswerText(score),
  }));
}

function getStudentAnswerText(score: RawScoreItem): string | null {
  return (
    score.studentAnswerText ||
    score.student_answer_text ||
    score.student_answer ||
    score.extracted_answer ||
    score.extracted_text ||
    null
  );
}
