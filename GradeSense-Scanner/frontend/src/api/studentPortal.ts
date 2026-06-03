import { getBackendUrl } from '../config';
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

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Bypass-Tunnel-Reminder': 'true',
  };
}

function endpoint(options: StudentPortalRequestOptions, path: string): string {
  return `${options.backendUrl ?? getBackendUrl()}${path}`;
}

async function parsePortalResponse<T>(res: Response, normalizer: (value: unknown) => T): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }

  const json = await res.json();
  return normalizer(json.data ?? json);
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
  const res = await fetch(endpoint(options, studentPortalEndpoints.dashboard), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, normalizeStudentDashboard);
}

export async function fetchStudentExams(options: StudentPortalRequestOptions): Promise<StudentExamSummary[]> {
  const res = await fetch(endpoint(options, studentPortalEndpoints.exams), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, normalizeStudentExams);
}

export async function fetchStudentSubmissions(options: StudentPortalRequestOptions): Promise<StudentSubmissionSummary[]> {
  const res = await fetch(endpoint(options, studentPortalEndpoints.submissions), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, normalizeStudentSubmissions);
}

export async function fetchStudentSubmissionDetail(
  options: StudentPortalRequestOptions,
  submissionId: string
): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(options, `${studentPortalEndpoints.submissions}/${submissionId}`), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, value => (value && typeof value === 'object' ? value as Record<string, unknown> : {}));
}

export async function fetchStudentExamFiles(
  options: StudentPortalRequestOptions,
  examId: string
): Promise<StudentExamFile[]> {
  const res = await fetch(endpoint(options, `/api/v1/student/exams/${examId}/files`), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, value => Array.isArray(value)
    ? value.map(row => {
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
    : []);
}

export async function fetchStudentReEvaluations(options: StudentPortalRequestOptions): Promise<Record<string, unknown>[]> {
  const res = await fetch(endpoint(options, studentPortalEndpoints.reEvaluations), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, value => (Array.isArray(value) ? value as Record<string, unknown>[] : []));
}

export async function createStudentReEvaluation(
  options: StudentPortalRequestOptions,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(options, studentPortalEndpoints.reEvaluations), {
    method: 'POST',
    headers: {
      ...authHeaders(options.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return parsePortalResponse(res, value => (value && typeof value === 'object' ? value as Record<string, unknown> : {}));
}
