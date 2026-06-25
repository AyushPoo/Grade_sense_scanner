import type { ScanPhase, ScanSession } from '../types';

const getCommonExamIssues = (session: ScanSession): string[] => {
  const issues: string[] = [];
  const totalMarks = Number(session.total_marks);
  const examDate = (session.exam_date || '').trim();

  if (!session.session_name?.trim()) issues.push('Exam name is required.');
  if (!session.batch_id || !session.batch_name?.trim()) issues.push('Batch is required.');
  if (!session.subject_id) issues.push('Subject is required.');
  if (!Number.isFinite(totalMarks) || totalMarks <= 0) issues.push('Total marks must be greater than 0.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || Number.isNaN(Date.parse(`${examDate}T00:00:00`))) {
    issues.push('Valid exam date is required.');
  }

  return issues;
};

const modelAnswerPageCount = (session: ScanSession): number => session.model_answer?.pages?.length || 0;

const studentDocumentCount = (session: ScanSession): number =>
  (session.students || []).filter(student => (student.pages || []).length > 0).length;

export const getUploadBlockingIssues = (session: ScanSession): string[] => {
  const issues = getCommonExamIssues(session);

  if (!session.parent_exam_id && modelAnswerPageCount(session) <= 0) {
    issues.push('Model Answer is required.');
  }
  if (studentDocumentCount(session) <= 0) issues.push('At least one student answer paper is required.');

  return issues;
};

export const getScanPhaseBlockingIssues = (session: ScanSession, phase: ScanPhase): string[] => {
  const issues = getCommonExamIssues(session);

  if (!session.parent_exam_id && phase === 'students' && modelAnswerPageCount(session) <= 0) {
    issues.push('Model Answer is required before scanning student answer papers.');
  }

  return issues;
};
