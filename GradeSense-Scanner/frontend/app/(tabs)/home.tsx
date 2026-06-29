import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Animated,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';
import {
  isActualGradingJob,
  isCompletedGradingJob,
  isFailedGradingJob,
  isReviewReadyExam,
  normalizeJobProgress,
  shouldShowGradingStatus,
} from '../../src/utils/gradingLifecycle';
import {
  ensureGradingNotificationReady,
  notifyGradingCompleteOnce,
  notifyGradingProgress,
} from '../../src/services/gradingNotifications';

const ACTIONABLE_SESSION_STATUSES = new Set(['scanning', 'ready', 'uploading', 'syncing', 'failed', 'sync_failed']);

// ─── Sub-components ───────────────────────────────────────────────────

function StatPill({ value, label, icon, highlight = false }: {
  value: number; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; highlight?: boolean;
}) {
  return (
    <View style={[statStyles.pill, highlight && { borderColor: COLORS.warning, borderWidth: 1.5 }]}>
      <View style={[statStyles.iconBox, { backgroundColor: highlight ? COLORS.warningLight : COLORS.primaryXLight }]}>
        <Ionicons name={icon} size={16} color={highlight ? COLORS.warning : COLORS.primary} />
      </View>
      <Text style={[statStyles.value, highlight && { color: COLORS.warning }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  pill: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.primary,
    lineHeight: 28,
  },
  label: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});

// ─── Grading Progress Card ─────────────────────────────────────────────
function GradingProgressCard({ session, job, onPress, onRetry, isRetrying, onDismiss }: any) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const { processed, total, percent } = normalizeJobProgress(job);
  const isSyncFailed = session.status === 'sync_failed' || session.status === 'failed';
  const isGradingFailed = isFailedGradingJob(job);
  const isComplete = isCompletedGradingJob(job);
  const isAwaitingFirstReview = job?.status === 'awaiting_first_review';

  useEffect(() => {
    if (!isComplete) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isComplete, pulseAnim]);

  const renderDismissButton = () => (
    <TouchableOpacity
      style={gradingStyles.dismissBtn}
      onPress={onDismiss}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="close" size={18} color={COLORS.textLight} />
    </TouchableOpacity>
  );

  if (isSyncFailed || isGradingFailed) {
    return (
      <View style={[gradingStyles.card, gradingStyles.failedCard]}>
        {renderDismissButton()}
        <View style={gradingStyles.completeTop}>
          <View style={[gradingStyles.completeIconBadge, gradingStyles.failedIconBadge]}>
            <Ionicons name="alert-circle" size={28} color={COLORS.error} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={gradingStyles.sessionTitle} numberOfLines={1}>{session.session_name}</Text>
            <Text style={[gradingStyles.statusText, { color: COLORS.error }]}>
              {isGradingFailed ? 'AI grading failed' : 'Sync failed before grading'}
            </Text>
          </View>
        </View>
        <Text style={gradingStyles.completeDetail} numberOfLines={2}>
          {job?.error || session.last_sync_error || 'The server could not create webapp submissions. Re-upload this exam after backend fixes are deployed.'}
        </Text>
        {session.exam_id ? (
          <TouchableOpacity
            style={gradingStyles.retryCTA}
            onPress={onRetry}
            disabled={isRetrying}
            activeOpacity={0.86}
          >
            <Ionicons name="refresh" size={15} color="#fff" />
            <Text style={gradingStyles.reviewCTAText}>{isRetrying ? 'Retrying...' : 'Retry grading'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (isComplete) {
    return (
      <TouchableOpacity style={[gradingStyles.card, gradingStyles.completeCard]} onPress={onPress} activeOpacity={0.88}>
        {renderDismissButton()}
        <View style={gradingStyles.completeTop}>
          <View style={gradingStyles.completeIconBadge}>
            <Ionicons name="checkmark-circle" size={28} color={COLORS.success} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={gradingStyles.sessionTitle} numberOfLines={1}>{session.session_name}</Text>
            <Text style={[gradingStyles.statusText, { color: COLORS.success }]}>✓ Grading complete</Text>
          </View>
        </View>
        <Text style={gradingStyles.completeDetail}>All submissions graded by AI. Tap to review marks.</Text>
        <View style={gradingStyles.reviewCTA}>
          <Text style={gradingStyles.reviewCTAText}>Review Papers & Marks</Text>
          <Ionicons name="arrow-forward" size={15} color="#fff" />
        </View>
      </TouchableOpacity>
    );
  }

  if (isAwaitingFirstReview) {
    return (
      <TouchableOpacity style={[gradingStyles.card, gradingStyles.pilotReviewCard]} onPress={onPress} activeOpacity={0.88}>
        {renderDismissButton()}
        <View style={gradingStyles.completeTop}>
          <View style={gradingStyles.pilotReviewIconBadge}>
            <Ionicons name="reader" size={25} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={gradingStyles.sessionTitle} numberOfLines={1}>{session.session_name}</Text>
            <Text style={[gradingStyles.statusText, { color: COLORS.primary }]}>First paper ready for review</Text>
          </View>
        </View>
        <Text style={gradingStyles.completeDetail}>Review the first graded paper. The remaining papers will continue after approval.</Text>
        <View style={gradingStyles.reviewCTA}>
          <Text style={gradingStyles.reviewCTAText}>Review First Paper</Text>
          <Ionicons name="arrow-forward" size={15} color="#fff" />
        </View>
      </TouchableOpacity>
    );
  }

  const statusLabel = job ? "AI grading in progress…" : "Syncing papers to webapp…";

  return (
    <View style={gradingStyles.card}>
      {renderDismissButton()}
      <View style={gradingStyles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={gradingStyles.sessionTitle} numberOfLines={1}>{session.session_name}</Text>
          <View style={gradingStyles.statusRow}>
            <Animated.View style={[gradingStyles.pulseDot, { opacity: pulseAnim }]} />
            <Text style={gradingStyles.statusText}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={gradingStyles.percentLabel}>{percent}%</Text>
      </View>
      <View style={gradingStyles.barTrack}>
        <Animated.View style={[gradingStyles.barFill, { width: `${Math.max(4, percent)}%` as any }]} />
      </View>
      <Text style={gradingStyles.countText}>
        {job ? `${processed} of ${total} papers checked` : 'Queued / starting grading on server...'}
      </Text>
    </View>
  );
}

const gradingStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  completeCard: {
    borderColor: COLORS.success,
    shadowColor: COLORS.success,
  },
  pilotReviewCard: {
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
  },
  failedCard: {
    borderColor: COLORS.error,
    shadowColor: COLORS.error,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  completeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  completeIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.successLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pilotReviewIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,107,53,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedIconBadge: {
    backgroundColor: COLORS.errorLight,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  statusText: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  percentLabel: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
  },
  barTrack: {
    height: 8,
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  barFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  countText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  completeDetail: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 19,
    marginBottom: 16,
  },
  reviewCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.success,
    paddingVertical: 13,
    borderRadius: 12,
  },
  retryCTA: {
    alignItems: 'center',
    backgroundColor: COLORS.error,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 13,
  },
  reviewCTAText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  dismissBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    padding: 4,
  },
});

// ─── Session Row Item ──────────────────────────────────────────────────
function SessionRow({ session, onPress }: { session: any; onPress: () => void }) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'uploaded': case 'completed':
        return { icon: 'checkmark-circle' as const, color: COLORS.success, bg: COLORS.successLight, label: 'Uploaded' };
      case 'grading':
        return { icon: 'sync-circle' as const, color: COLORS.primary, bg: COLORS.primaryXLight, label: 'Grading' };
      case 'graded':
        return { icon: 'checkmark-circle' as const, color: COLORS.success, bg: COLORS.successLight, label: 'Graded' };
      case 'uploading':
        return { icon: 'sync' as const, color: COLORS.primary, bg: COLORS.primaryXLight, label: `Uploading (${session.upload_progress || 0}%)` };
      case 'syncing':
        return { icon: 'sync' as const, color: COLORS.primary, bg: COLORS.primaryXLight, label: 'Syncing' };
      case 'sync_failed':
        return { icon: 'alert-circle' as const, color: COLORS.error, bg: COLORS.errorLight, label: 'Sync failed' };
      case 'ready':
        return { icon: 'time' as const, color: COLORS.warning, bg: COLORS.warningLight, label: 'Pending' };
      case 'failed':
        return { icon: 'alert-circle' as const, color: COLORS.error, bg: COLORS.errorLight, label: 'Failed' };
      default:
        return { icon: 'document-text' as const, color: COLORS.textMuted, bg: COLORS.surfaceElevated, label: 'Scanning' };
    }
  };

  const cfg = getStatusConfig(session.status);

  return (
    <TouchableOpacity style={rowStyles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={[rowStyles.iconWrap, { backgroundColor: cfg.bg }]}>
        <Ionicons name={cfg.icon} size={20} color={cfg.color} />
      </View>
      <View style={rowStyles.info}>
        <Text style={rowStyles.name} numberOfLines={1}>{session.session_name}</Text>
        <Text style={rowStyles.meta}>
          {session.stats?.total_students || 0} students · {session.stats?.total_pages || 0} pages
        </Text>
      </View>
      {session.status === 'uploaded' ? (
        <View style={[rowStyles.badge, { backgroundColor: COLORS.primaryXLight, borderColor: `${COLORS.primary}33`, borderWidth: 1 }]}>
          <Text style={[rowStyles.badgeText, { color: COLORS.primary }]}>Review</Text>
        </View>
      ) : (
        <View style={[rowStyles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[rowStyles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  meta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    marginLeft: 10,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
});

// ─── Main Screen ──────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { savedSessions, fetchSessions } = useScanStore();
  const [refreshing, setRefreshing] = useState(false);
  const [gradingProgress, setGradingProgress] = useState<Record<string, { progress: number, processed: number, total: number, status: string, type?: string, error?: string | null }>>({});
  const hasAcceptedDPDPConsent = useAuthStore(state => state.hasAcceptedDPDPConsent);
  const setHasAcceptedDPDPConsent = useAuthStore(state => state.setHasAcceptedDPDPConsent);
  const [localConsentChecked, setLocalConsentChecked] = useState(false);
  const [exams, setExams] = useState<any[]>([]);
  const [dismissedExamIds, setDismissedExamIds] = useState<string[]>([]);
  const [dismissedSessionIds, setDismissedSessionIds] = useState<string[]>([]);
  const [retryingExamIds, setRetryingExamIds] = useState<string[]>([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const completedJobRefreshRef = useRef<Set<string>>(new Set());
  const sessions = useMemo(
    () => (Array.isArray(savedSessions) ? savedSessions : []),
    [savedSessions]
  );
  const pollingSessions = useMemo(
    () => sessions.filter(s => ['syncing', 'grading', 'uploaded'].includes(s.status) && s.exam_id),
    [sessions]
  );

  const fetchExams = useCallback(async () => {
    const token = useAuthStore.getState().sessionToken;
    const backendUrl = getBackendUrl();
    if (!token || !backendUrl) return;
    
    try {
      const res = await fetch(`${backendUrl}/api/v1/exams`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Bypass-Tunnel-Reminder': 'true' }
      });
      if (res.ok) {
        const json = await res.json();
        setExams((json.data || []).filter((exam: any) => isReviewReadyExam(exam)));
      }
    } catch (err) {
      console.warn('Failed to fetch exams for home:', err);
    }
  }, []);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    fetchSessions().catch(err => console.error('Initial fetch failed:', err));
    fetchExams().catch(err => console.error('Failed to load exams:', err));
    ensureGradingNotificationReady().catch(() => {});
    AsyncStorage.getItem('gradesense.dismissedReviewExamIds')
      .then(value => {
        if (value) setDismissedExamIds(JSON.parse(value));
      })
      .catch(() => {});
    AsyncStorage.getItem('gradesense.dismissedSessionIds')
      .then(value => {
        if (value) setDismissedSessionIds(JSON.parse(value));
      })
      .catch(() => {});
  }, [fadeAnim, fetchExams, fetchSessions]);

  // Poll active grading jobs
  useEffect(() => {
    let active = true;
    const token = useAuthStore.getState().sessionToken;
    const webappUrl = getBackendUrl();
    if (!token || !webappUrl) return;

    if (pollingSessions.length === 0) return;

    const pollJobs = async () => {
      const updates = await Promise.all(
        pollingSessions.map(async session => {
          try {
            const res = await fetch(`${webappUrl}/api/v1/exams/${session.exam_id}/jobs`, {
              headers: { 'Authorization': `Bearer ${token}`, 'Bypass-Tunnel-Reminder': 'true' }
            });
            if (!res.ok) return null;
            const json = await res.json();
            const jobs = json.data || [];
            const gradingJobs = jobs.filter((j: any) => isActualGradingJob(j));
            const job = gradingJobs.find((j: any) => j.status !== 'completed') || gradingJobs[0];
            if (!job) return null;
            return {
              sessionId: session.session_id,
              progress: {
                progress: job.progress,
                processed: job.processedItems || 0,
                total: job.totalItems || 0,
                status: job.status,
                type: job.type,
                error: job.error || null,
              },
            };
          } catch {
            return null;
          }
        })
      );

      if (!active) return;
      const validUpdates = updates.filter(Boolean) as {
        sessionId: string;
        progress: { progress: number; processed: number; total: number; status: string; type?: string; error?: string | null };
      }[];
      if (!validUpdates.length) return;

      setGradingProgress(prev => {
        const next = { ...prev };
        validUpdates.forEach(update => {
          next[update.sessionId] = update.progress;
        });
        return next;
      });

      validUpdates.forEach(update => {
        const session = pollingSessions.find(item => item.session_id === update.sessionId);
        if (!session?.exam_id) return;

        const examId = String(session.exam_id);
        if (
          isActualGradingJob(update.progress)
          && !isCompletedGradingJob(update.progress)
          && !isFailedGradingJob(update.progress)
        ) {
          notifyGradingProgress(
            examId,
            session.session_name,
            update.progress.processed,
            update.progress.total,
            update.progress.progress,
          ).catch(() => {});
          return;
        }

        if (!isCompletedGradingJob(update.progress)) return;
        if (completedJobRefreshRef.current.has(examId)) return;
        completedJobRefreshRef.current.add(examId);

        notifyGradingCompleteOnce(examId, session.session_name).catch(() => {});
        fetchExams().catch(() => {});
        fetchSessions().catch(() => {});
      });
    };

    pollJobs();
    const interval = setInterval(pollJobs, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [pollingSessions]);

  // Periodic session status polling fail-safe (every 15s)
  useEffect(() => {
    const token = useAuthStore.getState().sessionToken;
    if (!token) return;

    const interval = setInterval(() => {
      fetchSessions().catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, [fetchSessions]);

  const todaySessions = sessions.filter(s => s.created_at && new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  const pendingUploads = sessions.filter(s => s.status === 'ready' || s.status === 'failed').length;
  const totalPages = sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0);
  const recentSessions = sessions
    .filter(session => ACTIONABLE_SESSION_STATUSES.has(session.status) && !gradingProgress[session.session_id])
    .slice(0, 5);

  const onRefresh = async () => {
    setRefreshing(true);
    try { 
      await Promise.all([
        fetchSessions(),
        fetchExams()
      ]);
    } catch { /* silent */ } finally { setRefreshing(false); }
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.name?.split(' ')[0] || 'Teacher';
  const visibleStatusSessions = sessions.filter(session => {
    const job = gradingProgress[session.session_id] || (session.grading_job_id ? {
      id: session.grading_job_id,
      type: session.grading_job_type || 'grade_submissions',
      status: session.grading_status || 'completed',
      progress: session.grading_progress || 100.0,
      processedItems: session.grading_processed_items || 0,
      totalItems: session.grading_total_items || 0,
    } : null);

    return shouldShowGradingStatus(session, job) &&
      (!session.exam_id || !dismissedExamIds.includes(String(session.exam_id))) &&
      !dismissedSessionIds.includes(session.session_id);
  });
  const readyExams = exams.filter(exam => !dismissedExamIds.includes(String(exam.id)));

  const dismissSession = async (sessionId: string) => {
    const nextDismissed = Array.from(new Set([...dismissedSessionIds, sessionId]));
    setDismissedSessionIds(nextDismissed);
    AsyncStorage.setItem('gradesense.dismissedSessionIds', JSON.stringify(nextDismissed)).catch(() => {});
  };

  const openReadyExam = async (exam: any) => {
    const examId = String(exam.id);
    const nextDismissed = Array.from(new Set([...dismissedExamIds, examId]));
    setDismissedExamIds(nextDismissed);
    AsyncStorage.setItem('gradesense.dismissedReviewExamIds', JSON.stringify(nextDismissed)).catch(() => {});
    router.push({ pathname: '/review-grading' as any, params: { examId: exam.id, sessionName: exam.name } });
  };

  const openCompletedGradingSession = async (session: any) => {
    if (!session.exam_id) return;
    const examId = String(session.exam_id);
    const nextDismissed = Array.from(new Set([...dismissedExamIds, examId]));
    setDismissedExamIds(nextDismissed);
    AsyncStorage.setItem('gradesense.dismissedReviewExamIds', JSON.stringify(nextDismissed)).catch(() => {});
    router.push({
      pathname: '/review-grading' as any,
      params: { examId: session.exam_id, sessionName: session.session_name }
    });
  };

  const retryGrading = async (session: any) => {
    const token = useAuthStore.getState().sessionToken;
    const backendUrl = getBackendUrl();
    if (!token || !backendUrl || !session.exam_id) {
      Alert.alert('Retry unavailable', 'This scan is missing the linked webapp exam.');
      return;
    }

    const examId = String(session.exam_id);
    setRetryingExamIds(prev => Array.from(new Set([...prev, examId])));
    try {
      const res = await fetch(`${backendUrl}/api/v1/exams/${examId}/retry-grading`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Bypass-Tunnel-Reminder': 'true',
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Status ${res.status}`);
      }

      await fetchSessions();
      await fetchExams();
      Alert.alert('Retry queued', 'GradeSense will rebuild the exam blueprint if needed and retry grading.');
    } catch (err: any) {
      Alert.alert('Retry failed', err?.message || 'Could not retry grading right now.');
    } finally {
      setRetryingExamIds(prev => prev.filter(id => id !== examId));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.userName}>{firstName} 👋</Text>
          {user?.org_name ? <Text style={styles.orgName}>{user.org_name}</Text> : null}
        </View>
        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.8}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{firstName[0]?.toUpperCase()}</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Primary CTA */}
        <TouchableOpacity style={styles.scanCTA} onPress={() => router.push('/session-setup')} activeOpacity={0.88}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.scanGradient}
          >
            <View style={styles.scanIconWrap}>
              <Ionicons name="scan" size={32} color={COLORS.primary} />
            </View>
            <View style={styles.scanText}>
              <Text style={styles.scanTitle}>New Scan/Upload</Text>
              <Text style={styles.scanSubtitle}>Set up, scan, or upload answer papers</Text>
            </View>
            <View style={styles.scanArrow}>
              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.8)" />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <StatPill value={todaySessions} label="Today" icon="calendar" />
          <StatPill value={pendingUploads} label="Pending" icon="time" highlight={pendingUploads > 0} />
          <StatPill value={totalPages} label="Pages" icon="documents" />
        </View>

        {/* Grading Progress Cards */}
        {visibleStatusSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>GRADING STATUS</Text>
            <View style={styles.cardList}>
              {visibleStatusSessions
                .slice(0, 3)
                .map(session => {
                  const job = gradingProgress[session.session_id] || (session.grading_job_id ? {
                    id: session.grading_job_id,
                    type: session.grading_job_type || 'grade_submissions',
                    status: session.grading_status || 'completed',
                    progress: session.grading_progress || 100.0,
                    processedItems: session.grading_processed_items || 0,
                    totalItems: session.grading_total_items || 0,
                  } : null);
                  const isComplete = isCompletedGradingJob(job);
                  return (
                    <GradingProgressCard
                      key={session.session_id}
                      session={session}
                      job={job}
                      onRetry={() => retryGrading(session)}
                      isRetrying={retryingExamIds.includes(String(session.exam_id))}
                      onPress={isComplete ? () => openCompletedGradingSession(session) : undefined}
                      onDismiss={() => dismissSession(session.session_id)}
                    />
                  );
                })}
            </View>
          </View>
        )}

        {/* Exams Ready for Review */}
        {readyExams.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>EXAMS READY FOR REVIEW</Text>
            </View>
            <View style={styles.cardList}>
              {readyExams.slice(0, 3).map(exam => (
                <TouchableOpacity
                  key={exam.id}
                  style={styles.examItem}
                  onPress={() => openReadyExam(exam)}
                  activeOpacity={0.8}
                >
                  <View style={styles.examIconWrap}>
                    <Ionicons name="checkbox-outline" size={20} color={COLORS.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.examName} numberOfLines={1}>{exam.name}</Text>
                    <Text style={styles.examMeta}>
                      Marks: {exam.totalMarks || 100} • Date: {exam.examDate ? new Date(exam.examDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                    </Text>
                  </View>
                  <View style={styles.reviewBadge}>
                    <Text style={styles.reviewBadgeText}>Review</Text>
                    <Ionicons name="chevron-forward" size={12} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>RECENT SESSIONS</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/sessions')} activeOpacity={0.7}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.cardList}>
              {recentSessions.map(session => (
                  <SessionRow
                    key={session.session_id}
                    session={session}
                    onPress={() => {
                      if (session.status === 'uploading' || session.status === 'syncing') {
                        router.push({ pathname: '/upload', params: { sessionId: session.session_id } });
                      } else if (session.status === 'uploaded' && session.exam_id) {
                        router.push({ pathname: '/review-grading' as any, params: { examId: session.exam_id, sessionName: session.session_name } });
                      } else {
                        router.push({ pathname: '/review', params: { sessionId: session.session_id } });
                      }
                    }}
                  />
                ))}
            </View>
          </View>
        )}

        {sessions.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="camera-outline" size={48} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptySubtitle}>Start by scanning your first batch of answer papers.</Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* DPDP Act 2023 Consent Modal */}
      <Modal
        visible={!hasAcceptedDPDPConsent}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.consentModalOverlay}>
          <View style={styles.consentModalContent}>
            <View style={styles.consentHeader}>
              <View style={styles.consentIconBadge}>
                <Ionicons name="shield-checkmark" size={32} color={COLORS.primary} />
              </View>
              <Text style={styles.consentModalTitle}>Legal Compliance Confirmation</Text>
            </View>

            <ScrollView style={styles.consentBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.consentNoticeText}>
                In accordance with the Digital Personal Data Protection (DPDP) Act, 2023 of India, educational institutions and educators acting as Data Fiduciaries are responsible for securing appropriate parental/guardian consent before uploading or processing the personal data and academic records of minors.
              </Text>
              <Text style={styles.consentNoticeText}>
                GradeSense operates solely as a Data Processor and evaluates papers strictly under your direction.
              </Text>

              <TouchableOpacity
                style={styles.consentCheckboxRow}
                onPress={() => setLocalConsentChecked(!localConsentChecked)}
                activeOpacity={0.8}
              >
                <View style={[
                  styles.consentCheckbox,
                  localConsentChecked && styles.consentCheckboxChecked
                ]}>
                  {localConsentChecked && (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </View>
                <Text style={styles.consentCheckboxLabel}>
                  I confirm that my school/institution has obtained the required student/parental consent under the DPDP Act, 2023 for uploading and processing academic papers on GradeSense.
                </Text>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.consentConfirmBtn,
                !localConsentChecked && styles.consentConfirmBtnDisabled
              ]}
              disabled={!localConsentChecked}
              onPress={() => setHasAcceptedDPDPConsent(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.consentConfirmBtnText}>CONFIRM & CONTINUE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  headerLeft: { flex: 1 },
  greeting: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  userName: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 2,
  },
  orgName: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
    marginTop: 2,
  },
  avatarBtn: { marginLeft: 16 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  // ── Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  // ── CTA
  scanCTA: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 7,
  },
  scanGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  scanIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  scanText: { flex: 1 },
  scanTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  scanSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 3 },
  scanArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // ── Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  // ── Section
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
  },
  seeAll: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  cardList: { gap: 10 },
  // ── Empty
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 21,
  },
  examItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  examIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.successLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  examName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  examMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  reviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  reviewBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // Consent Modal Styles
  consentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  consentModalContent: {
    backgroundColor: COLORS.background,
    borderRadius: 24,
    width: '100%',
    maxHeight: '85%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  consentHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  consentIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  consentModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  consentBody: {
    marginBottom: 24,
  },
  consentNoticeText: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    marginBottom: 14,
  },
  consentCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  consentCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  consentCheckboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  consentCheckboxLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 18,
  },
  consentConfirmBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentConfirmBtnDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  consentConfirmBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
