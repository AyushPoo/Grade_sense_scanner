type MaybeJob = {
  type?: string | null;
  status?: string | null;
  processed?: number | null;
  processedItems?: number | null;
  total?: number | null;
  totalItems?: number | null;
};

type MaybeSession = {
  status?: string | null;
};

type MaybeExam = {
  status?: string | null;
  reviewReady?: boolean | null;
  submissionCount?: number | null;
  gradedSubmissionCount?: number | null;
};

const GRADING_JOB_TYPES = new Set(['bulk_grade', 'grade_submissions']);
const ACTIVE_SESSION_STATUSES = new Set(['syncing', 'grading']);
const FAILED_SESSION_STATUSES = new Set(['sync_failed', 'failed']);
const FAILED_JOB_STATUSES = new Set(['failed', 'cancelled']);
const PILOT_REVIEW_JOB_STATUS = 'awaiting_first_review';

export function normalizeJobProgress(job: MaybeJob | null | undefined) {
  const processed = Number(job?.processed ?? job?.processedItems ?? 0);
  const total = Number(job?.total ?? job?.totalItems ?? 0);
  let percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  if (job?.status === 'completed') {
    percent = 100;
  }

  return {
    processed: job?.status === 'completed' ? Math.max(processed, total) : processed,
    total,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

export function isActualGradingJob(job: MaybeJob | null | undefined): boolean {
  return Boolean(job?.type && GRADING_JOB_TYPES.has(job.type) && normalizeJobProgress(job).total > 0);
}

export function isFailedGradingJob(job: MaybeJob | null | undefined): boolean {
  return isActualGradingJob(job) && FAILED_JOB_STATUSES.has(job?.status || '');
}

export function isCompletedGradingJob(job: MaybeJob | null | undefined): boolean {
  if (!isActualGradingJob(job)) {
    return false;
  }
  if (job?.status === PILOT_REVIEW_JOB_STATUS) {
    return false;
  }
  const progress = normalizeJobProgress(job);
  return job?.status === 'completed' && progress.processed >= progress.total;
}

export function shouldShowGradingStatus(session: MaybeSession, job: MaybeJob | null | undefined): boolean {
  if (FAILED_SESSION_STATUSES.has(session.status || '')) {
    return true;
  }
  if (isFailedGradingJob(job)) {
    return true;
  }
  if (isCompletedGradingJob(job)) {
    return true;
  }
  return ACTIVE_SESSION_STATUSES.has(session.status || '') || (isActualGradingJob(job) && job?.status !== 'completed');
}

export function isReviewReadyExam(exam: MaybeExam | null | undefined): boolean {
  if (!exam) {
    return false;
  }
  if (exam.reviewReady === true) {
    return true;
  }

  const submissionCount = Number(exam.submissionCount || 0);
  const gradedCount = Number(exam.gradedSubmissionCount || 0);
  const status = String(exam.status || '').toLowerCase();

  if (submissionCount <= 0) {
    return false;
  }
  if (status === 'published' || status === 'closed') {
    return true;
  }
  return gradedCount >= submissionCount;
}
