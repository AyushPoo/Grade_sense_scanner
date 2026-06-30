import type { ScanSession } from '../types';

type RecomputeStats = (session: ScanSession) => ScanSession['stats'];

interface ReconcileSessionsInput {
  currentSaved: ScanSession[];
  fetchedSessions: ScanSession[];
  deletedSessionIds: string[];
  recomputeStats: RecomputeStats;
}

interface ReconcileSessionsResult {
  savedSessions: ScanSession[];
  deletedSessionIds: string[];
}

const SERVER_TERMINAL_STATUSES = new Set<ScanSession['status']>([
  'uploaded',
  'completed',
  'grading',
  'graded',
  'sync_failed',
  'failed',
]);

const LOCAL_AUTHORITATIVE_STATUSES = new Set<ScanSession['status']>([
  'uploading',
  'syncing',
  'ready',
]);

export function reconcileFetchedScanSessions({
  currentSaved,
  fetchedSessions,
  deletedSessionIds,
  recomputeStats,
}: ReconcileSessionsInput): ReconcileSessionsResult {
  const deletedIds = new Set(deletedSessionIds || []);
  const fetchedIds = new Set(fetchedSessions.map(session => session.session_id));
  const activeFetched = fetchedSessions.filter(session => !deletedIds.has(session.session_id));

  const retainedLocalSessions = currentSaved.filter(session => {
    if (deletedIds.has(session.session_id)) {
      return false;
    }

    const isLocalOnly = !fetchedIds.has(session.session_id);
    if (!isLocalOnly) {
      return true;
    }

    return !isSyncedCloudSession(session);
  });

  const merged = [...retainedLocalSessions];

  activeFetched.forEach(fetched => {
    const localIdx = merged.findIndex(session => session.session_id === fetched.session_id);
    if (localIdx < 0) {
      merged.push(fetched);
      return;
    }

    merged[localIdx] = mergeFetchedSession({
      local: merged[localIdx],
      fetched,
      recomputeStats,
    });
  });

  const finalSessions = merged
    .filter(session => !deletedIds.has(session.session_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const remainingDeletedIds = (deletedSessionIds || []).filter(id => fetchedIds.has(id));

  return {
    savedSessions: finalSessions,
    deletedSessionIds: remainingDeletedIds,
  };
}

function mergeFetchedSession({
  local,
  fetched,
  recomputeStats,
}: {
  local: ScanSession;
  fetched: ScanSession;
  recomputeStats: RecomputeStats;
}): ScanSession {
  const localPages = countPages(local);
  const fetchedPages = countPages(fetched);

  if (local.status === 'scanning') {
    return {
      ...fetched,
      ...local,
      status: 'scanning',
      exam_id: local.exam_id,
      stats: recomputeStats(local),
    };
  }

  if (SERVER_TERMINAL_STATUSES.has(fetched.status)) {
    const statsSource = localPages >= fetchedPages ? local : fetched;
    return {
      ...local,
      ...fetched,
      stats: recomputeStats(statsSource),
    };
  }

  if (localPages > fetchedPages || LOCAL_AUTHORITATIVE_STATUSES.has(local.status)) {
    return {
      ...fetched,
      ...local,
      exam_id: local.exam_id || fetched.exam_id,
      stats: recomputeStats(local),
    };
  }

  return fetched;
}

function isSyncedCloudSession(session: ScanSession): boolean {
  return Boolean(session.exam_id) && SERVER_TERMINAL_STATUSES.has(session.status);
}

function countPages(session: ScanSession): number {
  return (
    (session.question_paper?.pages?.length || 0) +
    (session.model_answer?.pages?.length || 0) +
    (session.students?.reduce((sum, student) => sum + (student.pages?.length || 0), 0) || 0)
  );
}
