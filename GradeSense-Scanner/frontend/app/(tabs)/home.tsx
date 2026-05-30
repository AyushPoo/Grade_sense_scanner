import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';

const { width: SCREEN_W } = Dimensions.get('window');

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
function GradingProgressCard({ session, job, onPress }: any) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const percent = Math.round((job.processed / (job.total || 1)) * 100);
  const isComplete = job.status === 'completed';

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
  }, [isComplete]);

  if (isComplete) {
    return (
      <TouchableOpacity style={[gradingStyles.card, gradingStyles.completeCard]} onPress={onPress} activeOpacity={0.88}>
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

  return (
    <View style={gradingStyles.card}>
      <View style={gradingStyles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={gradingStyles.sessionTitle} numberOfLines={1}>{session.session_name}</Text>
          <View style={gradingStyles.statusRow}>
            <Animated.View style={[gradingStyles.pulseDot, { opacity: pulseAnim }]} />
            <Text style={gradingStyles.statusText}>AI grading in progress…</Text>
          </View>
        </View>
        <Text style={gradingStyles.percentLabel}>{percent}%</Text>
      </View>
      <View style={gradingStyles.barTrack}>
        <Animated.View style={[gradingStyles.barFill, { width: `${Math.max(4, percent)}%` as any }]} />
      </View>
      <Text style={gradingStyles.countText}>{job.processed} of {job.total} papers checked</Text>
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
  reviewCTAText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

// ─── Session Row Item ──────────────────────────────────────────────────
function SessionRow({ session, onPress }: { session: any; onPress: () => void }) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'uploaded': case 'completed':
        return { icon: 'checkmark-circle' as const, color: COLORS.success, bg: COLORS.successLight, label: 'Uploaded' };
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
  const { user, logout } = useAuthStore();
  const { savedSessions, fetchSessions } = useScanStore();
  const [refreshing, setRefreshing] = useState(false);
  const [gradingProgress, setGradingProgress] = useState<Record<string, { progress: number, processed: number, total: number, status: string }>>({});
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    fetchSessions().catch(err => console.error('Initial fetch failed:', err));
  }, []);

  // Poll active grading jobs
  useEffect(() => {
    let active = true;
    const token = useAuthStore.getState().sessionToken;
    const webappUrl = process.env.EXPO_PUBLIC_WEBAPP_URL;
    if (!token || !webappUrl) return;

    const pollJobs = async () => {
      const pending = sessions.filter(s => s.status === 'uploaded' && s.exam_id);
      for (const s of pending) {
        if (!s.exam_id) continue;
        try {
          const res = await fetch(`${webappUrl}/api/v1/exams/${s.exam_id}/jobs`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Bypass-Tunnel-Reminder': 'true' }
          });
          if (res.ok && active) {
            const json = await res.json();
            const jobs = json.data || [];
            const job = jobs.find((j: any) => j.type === 'bulk_grade' || j.status !== 'completed') || jobs[0];
            if (job) {
              setGradingProgress(prev => ({
                ...prev,
                [s.session_id]: { progress: job.progress, processed: job.processedItems || 0, total: job.totalItems || 0, status: job.status }
              }));
            }
          }
        } catch { /* silent */ }
      }
    };

    pollJobs();
    const interval = setInterval(pollJobs, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [savedSessions]);

  const sessions = Array.isArray(savedSessions) ? savedSessions : [];
  const todaySessions = sessions.filter(s => s.created_at && new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  const pendingUploads = sessions.filter(s => s.status === 'ready' || s.status === 'failed').length;
  const totalPages = sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0);
  const recentSessions = sessions.slice(0, 5);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await fetchSessions(); } catch { /* silent */ } finally { setRefreshing(false); }
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.name?.split(' ')[0] || 'Teacher';

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
              <Text style={styles.scanTitle}>New Scan Session</Text>
              <Text style={styles.scanSubtitle}>Set up and scan answer papers</Text>
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
        {sessions.some(s => s.status === 'uploaded' && gradingProgress[s.session_id]) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>GRADING STATUS</Text>
            <View style={styles.cardList}>
              {sessions
                .filter(s => s.status === 'uploaded' && gradingProgress[s.session_id])
                .slice(0, 3)
                .map(session => {
                  const job = gradingProgress[session.session_id];
                  const isComplete = job.status === 'completed';
                  return (
                    <GradingProgressCard
                      key={session.session_id}
                      session={session}
                      job={job}
                      onPress={isComplete ? () => router.push({
                        pathname: '/review-grading' as any,
                        params: { examId: session.exam_id, sessionName: session.session_name }
                      }) : undefined}
                    />
                  );
                })}
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
              {recentSessions
                .filter(s => !gradingProgress[s.session_id])
                .map(session => (
                  <SessionRow
                    key={session.session_id}
                    session={session}
                    onPress={() => {
                      if (session.status === 'uploaded' && session.exam_id) {
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
});
