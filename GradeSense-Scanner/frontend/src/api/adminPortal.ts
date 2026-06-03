import { getBackendUrl } from '../config';
import {
  AdminProductFeedback,
  AdminTeacher,
  TeacherInvite,
  normalizeAdminProductFeedback,
  normalizeAdminTeachers,
  normalizeTeacherInvites,
} from '../utils/adminPortalData';

export const adminPortalEndpoints = {
  teachers: '/api/v1/admin/teachers',
  teacherInvites: '/api/v1/admin/teacher-invites',
  feedback: '/api/v1/admin/feedback',
  auditLogs: '/api/v1/admin/audit-logs',
} as const;

export interface AdminPortalRequestOptions {
  token: string;
  backendUrl?: string;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Bypass-Tunnel-Reminder': 'true',
  };
}

function endpoint(options: AdminPortalRequestOptions, path: string): string {
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

export async function fetchAdminTeachers(options: AdminPortalRequestOptions): Promise<AdminTeacher[]> {
  const res = await fetch(endpoint(options, adminPortalEndpoints.teachers), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, normalizeAdminTeachers);
}

export async function updateAdminTeacherLimit(
  options: AdminPortalRequestOptions,
  userId: string,
  paperLimit: number
): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(options, `${adminPortalEndpoints.teachers}/${userId}`), {
    method: 'PATCH',
    headers: {
      ...authHeaders(options.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paperLimit }),
  });
  return parsePortalResponse(res, value => (value && typeof value === 'object' ? value as Record<string, unknown> : {}));
}

export async function fetchTeacherInvites(options: AdminPortalRequestOptions): Promise<TeacherInvite[]> {
  const res = await fetch(endpoint(options, adminPortalEndpoints.teacherInvites), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, normalizeTeacherInvites);
}

export async function inviteTeachers(
  options: AdminPortalRequestOptions,
  payload: { emails: string[]; paperLimit?: number }
): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(options, adminPortalEndpoints.teacherInvites), {
    method: 'POST',
    headers: {
      ...authHeaders(options.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return parsePortalResponse(res, value => (value && typeof value === 'object' ? value as Record<string, unknown> : {}));
}

export async function cancelTeacherInvite(options: AdminPortalRequestOptions, inviteId: string): Promise<void> {
  const res = await fetch(endpoint(options, `${adminPortalEndpoints.teacherInvites}/${inviteId}`), {
    method: 'DELETE',
    headers: authHeaders(options.token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
}

export async function fetchAdminFeedback(options: AdminPortalRequestOptions): Promise<AdminProductFeedback[]> {
  const res = await fetch(endpoint(options, adminPortalEndpoints.feedback), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, normalizeAdminProductFeedback);
}

export async function resolveAdminFeedback(
  options: AdminPortalRequestOptions,
  feedbackId: string,
  status: string
): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(options, `${adminPortalEndpoints.feedback}/${feedbackId}/resolve`), {
    method: 'PATCH',
    headers: {
      ...authHeaders(options.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
  return parsePortalResponse(res, value => (value && typeof value === 'object' ? value as Record<string, unknown> : {}));
}

export async function fetchAdminAuditLogs(options: AdminPortalRequestOptions): Promise<Record<string, unknown>[]> {
  const res = await fetch(endpoint(options, adminPortalEndpoints.auditLogs), {
    headers: authHeaders(options.token),
  });
  return parsePortalResponse(res, value => (Array.isArray(value) ? value as Record<string, unknown>[] : []));
}
