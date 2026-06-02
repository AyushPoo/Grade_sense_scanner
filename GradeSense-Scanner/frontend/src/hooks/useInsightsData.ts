import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { getBackendUrl } from '../config';
import { AIBrainRule, createAIBrainRule, fetchAIBrainRules } from '../api/aiBrain';
import { fetchManagePerformance } from '../api/manage';
import { ManagePerformance } from '../utils/manageData';

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
      setOverview(json.data || null);
      setIsOffline(false);
    } catch {
      setIsOffline(true);
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
