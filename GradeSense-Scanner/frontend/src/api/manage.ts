import {
  ManagedExam,
  ManagePerformance,
  normalizeManagedExams,
  normalizeManagePerformance,
} from '../utils/manageData';

interface ManageApiOptions {
  backendUrl: string;
  token: string;
}

interface ExamApiOptions extends ManageApiOptions {
  examId: string;
}

interface StudentApiOptions extends ManageApiOptions {
  batchId: string;
  studentId: string;
}

export interface UpdateManagedExamInput {
  name?: string;
  examDate?: string | null;
  totalMarks?: number;
  status?: string;
}

export interface UpdateBatchStudentInput {
  name?: string;
  rollNumber?: string;
  email?: string;
  mobileNumber?: string;
}

function authHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Bypass-Tunnel-Reminder': 'true',
  };
}

async function parseJsonResponse<T>(res: Response, normalizer: (value: unknown) => T): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }

  const json = await res.json();
  return normalizer(json.data ?? json);
}

function normalizeSingleExam(value: unknown): ManagedExam {
  const exam = normalizeManagedExams([value])[0];
  if (!exam) {
    throw new Error('Exam response was empty.');
  }
  return exam;
}

export async function fetchManagedExams({ backendUrl, token }: ManageApiOptions): Promise<ManagedExam[]> {
  const res = await fetch(`${backendUrl}/api/v1/exams`, {
    headers: authHeaders(token),
  });

  return parseJsonResponse(res, normalizeManagedExams);
}

export async function fetchManagePerformance({ backendUrl, token }: ManageApiOptions): Promise<ManagePerformance> {
  const res = await fetch(`${backendUrl}/api/v1/analytics/performance`, {
    headers: authHeaders(token),
  });

  return parseJsonResponse(res, normalizeManagePerformance);
}

export async function updateManagedExam(
  { backendUrl, token, examId }: ExamApiOptions,
  input: UpdateManagedExamInput
): Promise<ManagedExam> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function publishManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<ManagedExam> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/publish`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function closeManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<ManagedExam> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/close`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function archiveManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<void> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function updateBatchStudent(
  { backendUrl, token, batchId, studentId }: StudentApiOptions,
  input: UpdateBatchStudentInput
): Promise<unknown> {
  const res = await fetch(`${backendUrl}/api/batches/${batchId}/students/${studentId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }

  const json = await res.json();
  return json.student ?? json.data ?? json;
}
