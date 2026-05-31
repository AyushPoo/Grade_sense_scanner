import type { ScoreItem } from '../types/review';

export interface ImproveAIRequest {
  scoreId: string;
  questionNumber: string;
  questionText: string;
  studentAnswerText: string;
  aiGrade: number;
  expectedGrade: number;
  maxMarks: number;
  aiFeedback: string;
  teacherCorrection: string;
  applyToFuture: boolean;
}

type RawImprovedScore = Partial<ScoreItem> & {
  question_number?: string | number | null;
  obtained_marks?: number | string | null;
  max_marks?: number | string | null;
  ai_feedback?: string | null;
  teacher_correction?: string | null;
};

export function buildImproveAIRequest(
  score: ScoreItem,
  expectedGrade: number,
  teacherCorrection: string
): ImproveAIRequest {
  return {
    scoreId: score.id,
    questionNumber: score.questionNumber,
    questionText: score.questionText,
    studentAnswerText: score.studentAnswerText || '',
    aiGrade: score.obtainedMarks,
    expectedGrade: clampMarks(expectedGrade, score.maxMarks),
    maxMarks: score.maxMarks,
    aiFeedback: score.aiFeedback || '',
    teacherCorrection: teacherCorrection.trim(),
    applyToFuture: true,
  };
}

export function normalizeImproveAIResponseScore(current: ScoreItem, rawScore?: RawImprovedScore | null): ScoreItem {
  if (!rawScore) return current;

  return {
    ...current,
    questionNumber: String(rawScore.questionNumber || rawScore.question_number || current.questionNumber),
    obtainedMarks: Number(rawScore.obtainedMarks ?? rawScore.obtained_marks ?? current.obtainedMarks),
    maxMarks: Number(rawScore.maxMarks ?? rawScore.max_marks ?? current.maxMarks),
    aiFeedback: rawScore.aiFeedback ?? rawScore.ai_feedback ?? current.aiFeedback,
    teacherCorrection: rawScore.teacherCorrection ?? rawScore.teacher_correction ?? current.teacherCorrection,
  };
}

function clampMarks(value: number, maxMarks: number): number {
  const numericValue = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(numericValue, maxMarks));
}
