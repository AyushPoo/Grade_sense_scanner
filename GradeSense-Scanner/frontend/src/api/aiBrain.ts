export interface AIBrainRule {
  id: string;
  scope: 'global' | 'exam';
  examId?: string | null;
  questionNumber?: string | null;
  originalAiFeedback?: string | null;
  teacherCorrection: string;
  createdAt?: string | null;
}

export async function fetchAIBrainRules({ backendUrl, token }: { backendUrl: string; token: string }): Promise<AIBrainRule[]> {
  const res = await fetch(`${backendUrl}/api/v1/ai-brain`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Bypass-Tunnel-Reminder': 'true',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to load AI Brain: ${res.status}`);
  }

  const json = await res.json();
  return json.data || [];
}

export async function createAIBrainRule({
  backendUrl,
  token,
  rule,
}: {
  backendUrl: string;
  token: string;
  rule: string;
}): Promise<AIBrainRule> {
  const res = await fetch(`${backendUrl}/api/v1/ai-brain`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Bypass-Tunnel-Reminder': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ teacherCorrection: rule }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to save AI Brain rule: ${res.status}`);
  }

  const json = await res.json();
  return json.data || json;
}
