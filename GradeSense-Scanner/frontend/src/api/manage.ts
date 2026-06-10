import {
  ManagedBatch,
  ManagedExam,
  ManagedRosterStudent,
  ManagePerformance,
  normalizeManagedBatches,
  normalizeManagedExams,
  normalizeManagedRosterStudents,
  normalizeManagePerformance,
} from '../utils/manageData';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

interface ManageApiOptions {
  backendUrl: string;
  token: string;
  timeoutMs?: number;
}

interface ExamApiOptions extends ManageApiOptions {
  examId: string;
}

interface StudentApiOptions extends ManageApiOptions {
  batchId: string;
  studentId: string;
}

interface BatchStudentsApiOptions extends ManageApiOptions {
  batchId: string;
}

interface BatchApiOptions extends ManageApiOptions {
  batchId: string;
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

export interface UpdateManagedBatchInput {
  name?: string;
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
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams`, {
    headers: authHeaders(token),
  }, 2500);

  return parseJsonResponse(res, normalizeManagedExams);
}

export async function fetchManagedBatches({ backendUrl, token, timeoutMs = 8000 }: ManageApiOptions): Promise<ManagedBatch[]> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches`, {
    headers: authHeaders(token),
  }, timeoutMs);

  return parseJsonResponse(res, normalizeManagedBatches);
}

export async function updateManagedBatch(
  { backendUrl, token, batchId }: BatchApiOptions,
  input: UpdateManagedBatchInput
): Promise<ManagedBatch> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  }, 8000);

  const batch = await parseJsonResponse(res, normalizeManagedBatches);
  if (!batch[0]) {
    throw new Error('Batch response was empty.');
  }
  return batch[0];
}

export async function fetchBatchStudents({
  backendUrl,
  batchId,
  token,
  timeoutMs = 8000,
}: BatchStudentsApiOptions): Promise<ManagedRosterStudent[]> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}/students`, {
    headers: authHeaders(token),
  }, timeoutMs);

  return parseJsonResponse(res, normalizeManagedRosterStudents);
}

export async function fetchManagePerformance({ backendUrl, token }: ManageApiOptions): Promise<ManagePerformance> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/analytics/performance`, {
    headers: authHeaders(token),
  }, 2500);

  return parseJsonResponse(res, normalizeManagePerformance);
}

export async function updateManagedExam(
  { backendUrl, token, examId }: ExamApiOptions,
  input: UpdateManagedExamInput
): Promise<ManagedExam> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  }, 6000);

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function publishManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<ManagedExam> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}/publish`, {
    method: 'POST',
    headers: authHeaders(token),
  }, 8000);

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function closeManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<ManagedExam> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}/close`, {
    method: 'POST',
    headers: authHeaders(token),
  }, 8000);

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function archiveManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  }, 8000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function updateBatchStudent(
  { backendUrl, token, batchId, studentId }: StudentApiOptions,
  input: UpdateBatchStudentInput
): Promise<ManagedRosterStudent> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}/students/${studentId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  }, 8000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }

  const json = await res.json();
  const student = normalizeManagedRosterStudents(json.student ?? json.data ?? json)[0];
  if (!student) {
    throw new Error('Student response was empty.');
  }
  return student;
}
