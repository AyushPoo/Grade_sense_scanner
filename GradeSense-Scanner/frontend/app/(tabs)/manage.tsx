import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';

interface TeacherOverview {
  examsCount: number;
  submissionsCount: number;
  reviewedCount: number;
  averagePercentage: number;
  recentExams: Array<{
    id: string;
    name: string;
    examDate: string | null;
    totalMarks: number;
    status: string;
  }>;
}

function MetricCard({ value, label, icon, color, bg }: {
  value: string | number; label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string; bg: string;
}) {
  return (
    <View style={[metricStyles.card, { borderTopColor: color, borderTopWidth: 3 }]}>
      <View style={[metricStyles.iconBox, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[metricStyles.value, { color }]}>{value}</Text>
      <Text style={metricStyles.label}>{label}</Text>
    </View>
  );
}

const metricStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
  },
  label: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 3,
    textAlign: 'center',
  },
});

function ExamRow({ exam, onPress }: { exam: TeacherOverview['recentExams'][0]; onPress: () => void }) {
  const statusColor = exam.status === 'graded' ? COLORS.success : COLORS.warning;
  const statusBg = exam.status === 'graded' ? COLORS.successLight : COLORS.warningLight;
  const statusLabel = exam.status === 'graded' ? 'Graded' : 'Pending';

  return (
    <TouchableOpacity style={examStyles.row} onPress={onPress} activeOpacity={0.78}>
      <View style={examStyles.iconWrap}>
        <Ionicons name="school" size={20} color={COLORS.primary} />
      </View>
      <View style={examStyles.info}>
        <Text style={examStyles.name} numberOfLines={1}>{exam.name}</Text>
        <Text style={examStyles.date}>{exam.examDate ?? 'No date set'}</Text>
      </View>
      <View style={examStyles.right}>
        <View style={[examStyles.badge, { backgroundColor: statusBg }]}>
          <Text style={[examStyles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={{ marginLeft: 8 }} />
      </View>
    </TouchableOpacity>
  );
}

const examStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  date: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});

export default function ManageScreen() {
  const router = useRouter();
  const token = useAuthStore(s => s.sessionToken);
  const webappUrl = process.env.EXPO_PUBLIC_WEBAPP_URL;
  const { savedSessions } = useScanStore();

  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const localStats = React.useMemo(() => {
    const sessions = Array.isArray(savedSessions) ? savedSessions : [];
    return {
      sessions: sessions.length,
      uploaded: sessions.filter(s => s.status === 'uploaded').length,
      pending: sessions.filter(s => s.status === 'ready').length,
      pages: sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0),
    };
  }, [savedSessions]);

  const fetchData = async () => {
    if (!token || !webappUrl) {
      setIsLoading(false);
      setIsOffline(true);
      return;
    }
    try {
      const res = await fetch(`${webappUrl}/api/v1/analytics/overview`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Bypass-Tunnel-Reminder': 'true' },
      });
      if (res.ok) {
        const json = await res.json();
        setOverview(json.data);
        setIsOffline(false);
      } else {
        setIsOffline(true);
      }
    } catch {
      setIsOffline(true);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Analytics</Text>
          <Text style={styles.headerSub}>Grading insights & exam roster</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loaderText}>Fetching analytics…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {/* Offline Banner */}
          {isOffline && (
            <View style={styles.offlineBanner}>
              <Ionicons name="cloud-offline" size={16} color={COLORS.warning} />
              <Text style={styles.offlineText}>Offline – showing local data only</Text>
            </View>
          )}

          {/* Average score spotlight */}
          {!isOffline && overview && (
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryDark]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.spotlightCard}
            >
              <View style={styles.spotlightLeft}>
                <Text style={styles.spotlightLabel}>Class Average</Text>
                <Text style={styles.spotlightValue}>{overview.averagePercentage ?? '—'}%</Text>
                <Text style={styles.spotlightSub}>Across all graded exams</Text>
              </View>
              <View style={styles.spotlightIcon}>
                <Ionicons name="analytics" size={40} color="rgba(255,255,255,0.3)" />
              </View>
            </LinearGradient>
          )}

          {/* Metric grid */}
          <Text style={styles.sectionLabel}>OVERVIEW</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              value={overview?.examsCount ?? localStats.sessions}
              label="Exams"
              icon="school"
              color={COLORS.info}
              bg={COLORS.infoLight}
            />
            <MetricCard
              value={overview?.submissionsCount ?? localStats.pages}
              label="Submissions"
              icon="documents"
              color={COLORS.primary}
              bg={COLORS.primaryXLight}
            />
            <MetricCard
              value={overview?.reviewedCount ?? localStats.uploaded}
              label="Reviewed"
              icon="checkmark-done"
              color={COLORS.success}
              bg={COLORS.successLight}
            />
          </View>

          {/* Local stats */}
          <Text style={styles.sectionLabel}>LOCAL SESSIONS</Text>
          <View style={styles.localCard}>
            {[
              { icon: 'folder' as const, label: 'Total Sessions', value: localStats.sessions, color: COLORS.info },
              { icon: 'cloud-done' as const, label: 'Uploaded', value: localStats.uploaded, color: COLORS.success },
              { icon: 'time' as const, label: 'Pending Upload', value: localStats.pending, color: COLORS.warning },
              { icon: 'document-text' as const, label: 'Pages Scanned', value: localStats.pages, color: COLORS.primary },
            ].map((item, idx, arr) => (
              <View key={item.label} style={[styles.localRow, idx < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: COLORS.borderLight }]}>
                <View style={[styles.localIcon, { backgroundColor: `${item.color}18` }]}>
                  <Ionicons name={item.icon} size={16} color={item.color} />
                </View>
                <Text style={styles.localLabel}>{item.label}</Text>
                <Text style={[styles.localValue, { color: item.color }]}>{item.value}</Text>
              </View>
            ))}
          </View>

          {/* Quick shortcuts */}
          <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
          <View style={styles.shortcutRow}>
            <TouchableOpacity style={styles.shortcut} onPress={() => router.push('/session-setup')} activeOpacity={0.82}>
              <View style={[styles.shortcutIcon, { backgroundColor: COLORS.primaryXLight }]}>
                <Ionicons name="add-circle" size={26} color={COLORS.primary} />
              </View>
              <Text style={styles.shortcutTitle}>New Exam</Text>
              <Text style={styles.shortcutSub}>Scan papers</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shortcut} onPress={() => router.push('/(tabs)/sessions')} activeOpacity={0.82}>
              <View style={[styles.shortcutIcon, { backgroundColor: COLORS.successLight }]}>
                <Ionicons name="folder-open" size={24} color={COLORS.success} />
              </View>
              <Text style={styles.shortcutTitle}>Sessions</Text>
              <Text style={styles.shortcutSub}>Manage drafts</Text>
            </TouchableOpacity>
          </View>

          {/* Exam roster */}
          {overview?.recentExams && overview.recentExams.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>EXAM ROSTER</Text>
              <View style={styles.examListCard}>
                {overview.recentExams.map(exam => (
                  <ExamRow
                    key={exam.id}
                    exam={exam}
                    onPress={() => router.push({ pathname: '/review-grading' as any, params: { examId: exam.id, sessionName: exam.name } })}
                  />
                ))}
              </View>
            </>
          )}

          {isOffline && !overview && (
            <View style={styles.offlineState}>
              <Ionicons name="cloud-offline-outline" size={52} color={COLORS.textMuted} />
              <Text style={styles.offlineStateTitle}>No cloud data available</Text>
              <Text style={styles.offlineStateSub}>Connect to the internet and pull down to sync your analytics.</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.backgroundDark },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  headerSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Loader
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loaderText: { fontSize: 14, color: COLORS.textLight },

  // Scroll
  scrollContent: { padding: 16 },

  // Offline banner
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.warningLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${COLORS.warning}40`,
  },
  offlineText: { fontSize: 13, color: COLORS.warning, fontWeight: '600', flex: 1 },

  // Spotlight card
  spotlightCard: {
    flexDirection: 'row',
    borderRadius: 20,
    padding: 24,
    marginBottom: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  spotlightLeft: { flex: 1 },
  spotlightLabel: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  spotlightValue: { fontSize: 44, fontWeight: '800', color: '#fff', lineHeight: 50 },
  spotlightSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  spotlightIcon: { justifyContent: 'flex-end', alignItems: 'flex-end' },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 4,
  },

  // Metrics grid
  metricsGrid: { flexDirection: 'row', gap: 10, marginBottom: 24 },

  // Local stats card
  localCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  localRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  localIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  localLabel: { flex: 1, fontSize: 14, color: COLORS.textLight, fontWeight: '500' },
  localValue: { fontSize: 18, fontWeight: '800' },

  // Shortcuts
  shortcutRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  shortcut: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  shortcutIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  shortcutTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  shortcutSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },

  // Exam list
  examListCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginBottom: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },

  // Offline state
  offlineState: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  offlineStateTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  offlineStateSub: { fontSize: 14, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },
});
