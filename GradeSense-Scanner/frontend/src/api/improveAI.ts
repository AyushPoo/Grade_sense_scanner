import type { ScoreItem } from '../types/review';
import {
  buildImproveAIRequest,
  normalizeImproveAIResponseScore,
} from '../utils/improveAI';

interface ImproveAIOptions {
  backendUrl: string;
  token: string;
  submissionId: string;
  score: ScoreItem;
  expectedGrade: number;
  teacherCorrection: string;
}

export interface ImproveAIResult {
  score: ScoreItem;
  patternId?: string;
}

export async function submitQuestionImprovement({
  backendUrl,
  token,
  submissionId,
  score,
  expectedGrade,
  teacherCorrection,
}: ImproveAIOptions): Promise<ImproveAIResult> {
  const payload = buildImproveAIRequest(score, expectedGrade, teacherCorrection);
  const res = await fetch(`${backendUrl}/api/v1/submissions/${submissionId}/scores/${score.id}/improve-ai`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Bypass-Tunnel-Reminder': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(text || `Status ${res.status}`);
    (error as any).status = res.status;
    throw error;
  }

  const json = await res.json();
  const data = json.data || json;
  return {
    patternId: data.patternId,
    score: normalizeImproveAIResponseScore(score, data.score),
  };
}
