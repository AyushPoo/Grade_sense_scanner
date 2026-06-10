import type { ScanSession, ScanSessionSettings } from '../types';

interface DraftDetails {
  name: string;
  batchId: string;
  subjectId?: string;
  totalMarks?: number;
  examDate?: string;
  settings: ScanSessionSettings;
}

const REUSABLE_DRAFT_STATUSES = new Set<ScanSession['status']>(['scanning', 'ready', 'failed', 'sync_failed']);

function sameOptionalString(left?: string | null, right?: string | null) {
  return (left || '') === (right || '');
}

function sameOptionalNumber(left?: number | null, right?: number | null) {
  return Number(left || 0) === Number(right || 0);
}

function hasNoPages(session: ScanSession) {
  return (
    (session.stats?.total_pages || 0) === 0
    && (session.question_paper?.pages?.length || 0) === 0
    && (session.model_answer?.pages?.length || 0) === 0
    && (session.students || []).every(student => (student.pages || []).length === 0)
  );
}

function sameScanShape(sessionSettings: ScanSessionSettings, requestedSettings: ScanSessionSettings) {
  return (
    sessionSettings.scan_question_paper === requestedSettings.scan_question_paper
    && sessionSettings.scan_model_answer === requestedSettings.scan_model_answer
    && sessionSettings.page_mode === requestedSettings.page_mode
    && sessionSettings.grading_mode === requestedSettings.grading_mode
  );
}

export function findReusableDraftSession(
  sessions: ScanSession[],
  details: DraftDetails
): ScanSession | null {
  const cleanName = details.name.trim();

  return sessions.find(session => (
    session.session_id.startsWith('local_')
    && REUSABLE_DRAFT_STATUSES.has(session.status)
    && hasNoPages(session)
    && session.session_name.trim() === cleanName
    && session.batch_id === details.batchId
    && sameOptionalString(session.subject_id, details.subjectId)
    && sameOptionalNumber(session.total_marks, details.totalMarks)
    && sameOptionalString(session.exam_date, details.examDate)
    && sameScanShape(session.settings, details.settings)
  )) || null;
}
