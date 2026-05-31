import {
  buildReviewSettingsPayload,
  normalizeReviewSettings,
  ReviewSettings,
} from '../utils/reviewSettings';

interface ApiOptions {
  backendUrl: string;
  token: string;
  examId: string;
}

function authHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Bypass-Tunnel-Reminder': 'true',
  };
}

export async function fetchExamReviewSettings({ backendUrl, token, examId }: ApiOptions): Promise<ReviewSettings> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/settings`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const json = await res.json();
  return normalizeReviewSettings(json.data || json);
}

export async function updateExamReviewSettings(
  { backendUrl, token, examId }: ApiOptions,
  settings: ReviewSettings
): Promise<ReviewSettings> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/settings`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildReviewSettingsPayload(settings)),
  });

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(text || `Status ${res.status}`);
    (error as any).status = res.status;
    throw error;
  }

  const json = await res.json();
  return normalizeReviewSettings(json.data || json);
}

export async function flagExamGrading({ backendUrl, token, examId }: ApiOptions, settings: ReviewSettings): Promise<void> {
  const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/flag-grading`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildReviewSettingsPayload(settings)),
  });

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(text || `Status ${res.status}`);
    (error as any).status = res.status;
    throw error;
  }
}
