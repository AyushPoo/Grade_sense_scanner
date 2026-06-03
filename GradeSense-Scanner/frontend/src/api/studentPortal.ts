import { fetchPortalJson } from './portalApi';
import {
  StudentDashboardData,
  StudentSubmissionSummary,
  normalizeStudentDashboard,
  normalizeStudentSubmissions,
} from '../utils/studentPortalData';

export const studentPortalEndpoints = {
  dashboard: '/api/v1/student/dashboard',
  exams: '/api/v1/student/exams',
  submissions: '/api/v1/student/submissions',
  reEvaluations: '/api/v1/student/re-evaluations',
} as const;

export interface StudentPortalRequestOptions {
  token: string;
  backendUrl?: string;
  webappUrl?: string;
}

export interface StudentExamSummary {
  id: string;
  name: string;
  subjectName: string;
  totalMarks: number;
  examDate: string | null;
  status: string;
  resultsPublished: boolean;
}

export interface StudentExamFile {
  id: string;
  examId: string;
  kind: string;
  originalName: string;
  contentType: string;
  signedUrl: string | null;
}

function portalOptions(options: StudentPortalRequestOptions) {
  return {
    token: options.token,
    scannerBaseUrl: options.backendUrl,
    webappBaseUrl: options.webappUrl,
  };
}

function normalizeStudentExams(value: unknown): StudentExamSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map(row => {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const id = String(item.id ?? '');
    if (!id) return null;
    return {
      id,
      name: String(item.name ?? 'Exam'),
      subjectName: String(item.subjectName ?? item.subject_name ?? 'General'),
      totalMarks: Number(item.totalMarks ?? item.total_marks ?? 0),
      examDate: typeof (item.examDate ?? item.exam_date) === 'string'
        ? String(item.examDate ?? item.exam_date)
        : null,
      status: String(item.status ?? 'assigned'),
      resultsPublished: Boolean(item.resultsPublished ?? item.results_published),
    };
  }).filter((item): item is StudentExamSummary => item !== null);
}

export async function fetchStudentDashboard(options: StudentPortalRequestOptions): Promise<StudentDashboardData> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: studentPortalEndpoints.dashboard,
    webappPath: '/api/v1/analytics/student-dashboard',
  });
  return normalizeStudentDashboard(data);
}

export async function fetchStudentExams(options: StudentPortalRequestOptions): Promise<StudentExamSummary[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: studentPortalEndpoints.exams,
    webappPath: '/api/v1/exams',
  });
  return normalizeStudentExams(data);
}

export async function fetchStudentSubmissions(options: StudentPortalRequestOptions): Promise<StudentSubmissionSummary[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: studentPortalEndpoints.submissions,
    webappPath: '/api/v1/submissions/mine',
  });
  return normalizeStudentSubmissions(data);
}

export async function fetchStudentSubmissionDetail(
  options: StudentPortalRequestOptions,
  submissionId: string
): Promise<Record<string, unknown>> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: `${studentPortalEndpoints.submissions}/${submissionId}`,
    webappPath: `/api/v1/submissions/${submissionId}`,
  });
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

export async function fetchStudentExamFiles(
  options: StudentPortalRequestOptions,
  examId: string
): Promise<StudentExamFile[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: `/api/v1/student/exams/${examId}/files`,
    webappPath: `/api/v1/exams/${examId}/files`,
  });
  return Array.isArray(data)
    ? data.map(row => {
      const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return {
        id: String(item.id ?? ''),
        examId: String(item.examId ?? item.exam_id ?? ''),
        kind: String(item.kind ?? ''),
        originalName: String(item.originalName ?? item.original_name ?? ''),
        contentType: String(item.contentType ?? item.content_type ?? ''),
        signedUrl: typeof (item.signedUrl ?? item.signed_url) === 'string' ? String(item.signedUrl ?? item.signed_url) : null,
      };
    }).filter(file => file.id || file.signedUrl)
    : [];
}

export async function fetchStudentReEvaluations(options: StudentPortalRequestOptions): Promise<Record<string, unknown>[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: studentPortalEndpoints.reEvaluations,
    webappPath: '/api/v1/re-evaluations',
  });
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}

export async function createStudentReEvaluation(
  options: StudentPortalRequestOptions,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    method: 'POST',
    scannerPath: studentPortalEndpoints.reEvaluations,
    webappPath: '/api/v1/re-evaluations',
    body: payload,
  });
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}
