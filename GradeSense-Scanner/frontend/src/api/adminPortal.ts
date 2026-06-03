import { fetchPortalJson } from './portalApi';
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
  webappUrl?: string;
}

function portalOptions(options: AdminPortalRequestOptions) {
  return {
    token: options.token,
    scannerBaseUrl: options.backendUrl,
    webappBaseUrl: options.webappUrl,
  };
}

export async function fetchAdminTeachers(options: AdminPortalRequestOptions): Promise<AdminTeacher[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: adminPortalEndpoints.teachers,
    webappPath: '/api/v1/admin/users',
  });
  return normalizeAdminTeachers(data);
}

export async function updateAdminTeacherLimit(
  options: AdminPortalRequestOptions,
  userId: string,
  paperLimit: number
): Promise<Record<string, unknown>> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    method: 'PATCH',
    scannerPath: `${adminPortalEndpoints.teachers}/${userId}`,
    webappPath: `/api/v1/admin/users/${userId}`,
    body: { paperLimit },
  });
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

export async function fetchTeacherInvites(options: AdminPortalRequestOptions): Promise<TeacherInvite[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: adminPortalEndpoints.teacherInvites,
    webappPath: '/api/v1/admin/teacher-invites',
  });
  return normalizeTeacherInvites(data);
}

export async function inviteTeachers(
  options: AdminPortalRequestOptions,
  payload: { emails: string[]; paperLimit?: number }
): Promise<Record<string, unknown>> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    method: 'POST',
    scannerPath: adminPortalEndpoints.teacherInvites,
    webappPath: '/api/v1/admin/teacher-invites',
    body: payload,
  });
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

export async function cancelTeacherInvite(options: AdminPortalRequestOptions, inviteId: string): Promise<void> {
  await fetchPortalJson({
    ...portalOptions(options),
    method: 'DELETE',
    scannerPath: `${adminPortalEndpoints.teacherInvites}/${inviteId}`,
    webappPath: `/api/v1/admin/teacher-invites/${inviteId}`,
  });
}

export async function fetchAdminFeedback(options: AdminPortalRequestOptions): Promise<AdminProductFeedback[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: adminPortalEndpoints.feedback,
    webappPath: '/api/v1/feedback',
  });
  return normalizeAdminProductFeedback(data);
}

export async function resolveAdminFeedback(
  options: AdminPortalRequestOptions,
  feedbackId: string,
  status: string
): Promise<Record<string, unknown>> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    method: 'PATCH',
    scannerPath: `${adminPortalEndpoints.feedback}/${feedbackId}/resolve`,
    webappPath: `/api/v1/feedback/${feedbackId}/resolve`,
    body: { status },
  });
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

export async function fetchAdminAuditLogs(options: AdminPortalRequestOptions): Promise<Record<string, unknown>[]> {
  const data = await fetchPortalJson({
    ...portalOptions(options),
    scannerPath: adminPortalEndpoints.auditLogs,
    webappPath: '/api/v1/admin/audit-logs',
  });
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}
