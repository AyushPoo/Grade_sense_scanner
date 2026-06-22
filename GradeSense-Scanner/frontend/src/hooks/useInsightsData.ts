import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { getBackendUrl } from '../config';
import { AIBrainRule, createAIBrainRule, fetchAIBrainRules } from '../api/aiBrain';
import { fetchManagedExams, fetchManagePerformance } from '../api/manage';
import { ManagedExam, ManagePerformance } from '../utils/manageData';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

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
  const hasUsableDataRef = useRef(false);
  const lastGoodOverviewRef = useRef<TeacherInsightsOverview | null>(null);
  const lastGoodPerformanceRef = useRef<ManagePerformance | null>(null);
  const refreshInFlightRef = useRef(false);

  const backendUrl = useMemo(() => getBackendUrl(), []);

  const loadOverview = useCallback(async () => {
    if (!token) {
      setIsOffline(true);
      return;
    }

    try {
      const [apiOverview, exams] = await Promise.all([
        fetchWithTimeout(`${backendUrl}/api/v1/analytics/overview`, {
          headers: { Authorization: `Bearer ${token}` },
        }, 8000)
          .then(async res => {
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const json = await res.json();
            return normalizeOverview(json.data);
          })
          .catch(() => null),
        fetchManagedExams({ backendUrl, token }).catch(() => null),
      ]);

      if (exams) {
        const nextOverview = mergeOverviewWithExams(apiOverview, exams);
        if (hasOverviewSignal(nextOverview) || !lastGoodOverviewRef.current) {
          lastGoodOverviewRef.current = nextOverview;
          hasUsableDataRef.current = hasOverviewSignal(nextOverview) || hasUsableDataRef.current;
          setOverview(nextOverview);
        } else {
          setOverview(lastGoodOverviewRef.current);
        }
        setIsOffline(false);
      } else if (apiOverview) {
        if (hasOverviewSignal(apiOverview) || !lastGoodOverviewRef.current) {
          lastGoodOverviewRef.current = apiOverview;
          hasUsableDataRef.current = hasOverviewSignal(apiOverview) || hasUsableDataRef.current;
          setOverview(apiOverview);
        } else {
          setOverview(lastGoodOverviewRef.current);
        }
        setIsOffline(false);
      } else {
        setIsOffline(true);
      }
    } catch {
      setIsOffline(true);
    }
  }, [backendUrl, token]);

  const loadPerformance = useCallback(async () => {
    if (!token) return;
    try {
      const nextPerformance = await fetchManagePerformance({ backendUrl, token });
      if (hasPerformanceSignal(nextPerformance) || !lastGoodPerformanceRef.current) {
        lastGoodPerformanceRef.current = nextPerformance;
        hasUsableDataRef.current = hasPerformanceSignal(nextPerformance) || hasUsableDataRef.current;
        setPerformance(nextPerformance);
      } else {
        setPerformance(lastGoodPerformanceRef.current);
      }
    } catch (err) {
      console.error('Failed to load insights performance:', err);
    }
  }, [backendUrl, token]);

  const loadBrainRules = useCallback(async () => {
    if (!token) return;
    try {
      const rules = await fetchAIBrainRules({ backendUrl, token });
      if (rules.length > 0) {
        hasUsableDataRef.current = true;
      }
      setBrainRules(rules);
    } catch (err) {
      console.error('Failed to load AI Brain rules:', err);
    }
  }, [backendUrl, token]);

  const refresh = useCallback(async (silent = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!silent && !hasUsableDataRef.current) {
      setIsLoading(true);
    }
    setIsRefreshing(true);
    try {
      await Promise.all([loadOverview(), loadPerformance(), loadBrainRules()]);
    } finally {
      refreshInFlightRef.current = false;
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

function hasOverviewSignal(value: TeacherInsightsOverview | null): boolean {
  if (!value) return false;
  return (
    value.examsCount > 0
    || value.submissionsCount > 0
    || value.reviewedCount > 0
    || value.averagePercentage > 0
  );
}

function hasPerformanceSignal(value: ManagePerformance | null): boolean {
  if (!value) return false;
  return (
    value.subjectPerformance.length > 0
    || value.studentRankings.length > 0
    || value.weakStudents.length > 0
    || value.weakQuestions.length > 0
  );
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
