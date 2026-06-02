import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { getBackendUrl } from '../config';
import { AIBrainRule, createAIBrainRule, fetchAIBrainRules } from '../api/aiBrain';
import { fetchManagedExams, fetchManagePerformance } from '../api/manage';
import { ManagedExam, ManagePerformance } from '../utils/manageData';

export interface TeacherInsightsOverview {
  examsCount: number;
  submissionsCount: number;
  reviewedCount: number;
  averagePercentage: number;
}

interface UseInsightsDataParams {
  token: string | null;
}

export function useInsightsData({ token }: UseInsightsDataParams) {
  const [overview, setOverview] = useState<TeacherInsightsOverview | null>(null);
  const [performance, setPerformance] = useState<ManagePerformance | null>(null);
  const [brainRules, setBrainRules] = useState<AIBrainRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [savingBrainRule, setSavingBrainRule] = useState(false);

  const backendUrl = useMemo(() => getBackendUrl(), []);

  const loadOverview = useCallback(async () => {
    if (!token) {
      setIsOffline(true);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${backendUrl}/api/v1/analytics/overview`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const json = await res.json();
      const apiOverview = normalizeOverview(json.data);
      const exams = await fetchManagedExams({ backendUrl, token });
      setOverview(mergeOverviewWithExams(apiOverview, exams));
      setIsOffline(false);
    } catch {
      try {
        const exams = await fetchManagedExams({ backendUrl, token });
        setOverview(buildOverviewFromExams(exams));
        setIsOffline(false);
      } catch {
        setIsOffline(true);
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [backendUrl, token]);

  const loadPerformance = useCallback(async () => {
    if (!token) return;
    try {
      setPerformance(await fetchManagePerformance({ backendUrl, token }));
    } catch (err) {
      console.error('Failed to load insights performance:', err);
    }
  }, [backendUrl, token]);

  const loadBrainRules = useCallback(async () => {
    if (!token) return;
    try {
      setBrainRules(await fetchAIBrainRules({ backendUrl, token }));
    } catch (err) {
      console.error('Failed to load AI Brain rules:', err);
    }
  }, [backendUrl, token]);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setIsRefreshing(true);
    try {
      await Promise.all([loadOverview(), loadPerformance(), loadBrainRules()]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [loadBrainRules, loadOverview, loadPerformance]);

  const saveBrainRule = useCallback(async (rule: string) => {
    if (!token || !rule.trim()) return false;
    setSavingBrainRule(true);
    try {
      const created = await createAIBrainRule({
        backendUrl,
        token,
        rule: rule.trim(),
      });
      setBrainRules(prev => [created, ...prev]);
      return true;
    } catch (err: any) {
      Alert.alert('AI Brain not saved', err.message || 'Could not save this rule.');
      return false;
    } finally {
      setSavingBrainRule(false);
    }
  }, [backendUrl, token]);

  return {
    overview,
    performance,
    brainRules,
    isLoading,
    isRefreshing,
    isOffline,
    savingBrainRule,
    refresh,
    saveBrainRule,
  };
}

function normalizeOverview(value: unknown): TeacherInsightsOverview | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return {
    examsCount: readNumber(item.examsCount),
    submissionsCount: readNumber(item.submissionsCount),
    reviewedCount: readNumber(item.reviewedCount),
    averagePercentage: readNumber(item.averagePercentage),
  };
}

function mergeOverviewWithExams(
  apiOverview: TeacherInsightsOverview | null,
  exams: ManagedExam[]
): TeacherInsightsOverview {
  const examOverview = buildOverviewFromExams(exams);
  if (!apiOverview) return examOverview;

  return {
    examsCount: Math.max(apiOverview.examsCount, examOverview.examsCount),
    submissionsCount: Math.max(apiOverview.submissionsCount, examOverview.submissionsCount),
    reviewedCount: Math.max(apiOverview.reviewedCount, examOverview.reviewedCount),
    averagePercentage: apiOverview.averagePercentage > 0
      ? apiOverview.averagePercentage
      : examOverview.averagePercentage,
  };
}

function buildOverviewFromExams(exams: ManagedExam[]): TeacherInsightsOverview {
  const nonDeleted = exams.filter(exam => exam.status !== 'deleted');
  const submissionsCount = nonDeleted.reduce((sum, exam) => sum + exam.submissionCount, 0);
  const reviewedCount = nonDeleted.reduce(
    (sum, exam) => sum + Math.max(exam.gradedSubmissionCount, exam.reviewReady ? exam.submissionCount : 0),
    0
  );
  const scored = nonDeleted.filter(exam => exam.averagePercentage > 0);
  const averagePercentage = scored.length
    ? Math.round((scored.reduce((sum, exam) => sum + exam.averagePercentage, 0) / scored.length) * 10) / 10
    : 0;

  return {
    examsCount: nonDeleted.length,
    submissionsCount,
    reviewedCount,
    averagePercentage,
  };
}

function readNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
