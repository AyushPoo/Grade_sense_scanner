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

export interface CreateManagedBatchInput {
  name: string;
}

export interface CreateBatchStudentInput {
  name: string;
  rollNumber: string;
  email?: string;
}

function authHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Bypass-Tunnel-Reminder': 'true',
  };
}

function jsonHeaders(token: string) {
  return {
    ...authHeaders(token),
    'Content-Type': 'application/json',
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
  }, 20000);

  return parseJsonResponse(res, normalizeManagedExams);
}

export async function fetchManagedBatches({ backendUrl, token, timeoutMs = 20000 }: ManageApiOptions): Promise<ManagedBatch[]> {
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
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  }, 20000);

  const batch = await parseJsonResponse(res, normalizeManagedBatches);
  if (!batch[0]) {
    throw new Error('Batch response was empty.');
  }
  return batch[0];
}

export async function createManagedBatch(
  { backendUrl, token }: ManageApiOptions,
  input: CreateManagedBatchInput
): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  }, 20000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function deleteManagedBatch({ backendUrl, token, batchId }: BatchApiOptions): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  }, 20000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function archiveManagedBatch({ backendUrl, token, batchId }: BatchApiOptions): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}/archive`, {
    method: 'POST',
    headers: authHeaders(token),
  }, 20000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function fetchBatchStudents({
  backendUrl,
  batchId,
  token,
  timeoutMs = 20000,
}: BatchStudentsApiOptions): Promise<ManagedRosterStudent[]> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}/students`, {
    headers: authHeaders(token),
  }, timeoutMs);

  return parseJsonResponse(res, normalizeManagedRosterStudents);
}

export async function fetchManagePerformance({ backendUrl, token }: ManageApiOptions): Promise<ManagePerformance> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/analytics/performance`, {
    headers: authHeaders(token),
  }, 20000);

  return parseJsonResponse(res, normalizeManagePerformance);
}

export async function updateManagedExam(
  { backendUrl, token, examId }: ExamApiOptions,
  input: UpdateManagedExamInput
): Promise<ManagedExam> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}`, {
    method: 'PATCH',
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  }, 6000);

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function publishManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<ManagedExam> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}/publish`, {
    method: 'POST',
    headers: authHeaders(token),
  }, 20000);

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function closeManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<ManagedExam> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}/close`, {
    method: 'POST',
    headers: authHeaders(token),
  }, 20000);

  return parseJsonResponse(res, normalizeSingleExam);
}

export async function archiveManagedExam({ backendUrl, token, examId }: ExamApiOptions): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  }, 20000);

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
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  }, 20000);

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

export async function createBatchStudent(
  { backendUrl, token, batchId }: BatchStudentsApiOptions,
  input: CreateBatchStudentInput
): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}/students`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify(input),
  }, 20000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function deleteBatchStudent(
  { backendUrl, token, batchId, studentId }: StudentApiOptions
): Promise<void> {
  const res = await fetchWithTimeout(`${backendUrl}/api/batches/${batchId}/students/${studentId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  }, 20000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }
}

export async function replaceExamFile(
  { backendUrl, token, examId }: ExamApiOptions,
  kind: 'question_paper' | 'model_answer',
  fileUri: string,
  fileName: string,
  fileType: string
): Promise<any> {
  const formData = new FormData();
  formData.append('kind', kind);
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: fileType,
  } as any);

  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/files/replace`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Bypass-Tunnel-Reminder': 'true',
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }

  return res.json();
}

export async function regradeExam(
  { backendUrl, token, examId }: ExamApiOptions
): Promise<any> {
  const res = await fetchWithTimeout(`${backendUrl}/api/v1/exams/${examId}/regrade`, {
    method: 'POST',
    headers: authHeaders(token),
  }, 15000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Status ${res.status}`);
  }

  return res.json();
}
