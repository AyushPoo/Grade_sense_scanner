import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useScanStore } from '../../src/store/scanStore';
import { ScanSession } from '../../src/types';

const STATUS_MAP: Record<string, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; bg: string; label: string }> = {
  uploaded:  { icon: 'checkmark-circle', color: COLORS.success,  bg: COLORS.successLight,  label: 'Uploaded'    },
  completed: { icon: 'checkmark-circle', color: COLORS.success,  bg: COLORS.successLight,  label: 'Uploaded'    },
  ready:     { icon: 'time',             color: COLORS.warning,  bg: COLORS.warningLight,  label: 'Pending'     },
  uploading: { icon: 'cloud-upload',     color: COLORS.info,     bg: COLORS.infoLight,     label: 'Uploading…'  },
  failed:    { icon: 'alert-circle',     color: COLORS.error,    bg: COLORS.errorLight,    label: 'Failed'      },
  scanning:  { icon: 'document',         color: COLORS.textMuted,bg: COLORS.surfaceElevated, label: 'Scanning'  },
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

export default function SessionsScreen() {
  const router = useRouter();
  const { savedSessions, deleteSession, fetchSessions } = useScanStore();
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    fetchSessions().catch(() => {});
  }, []);

  const sessions = Array.isArray(savedSessions) ? savedSessions : [];

  const onRefresh = async () => {
    setRefreshing(true);
    try { await fetchSessions(); } catch { /* silent */ } finally { setRefreshing(false); }
  };

  const handleDelete = (session: ScanSession) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${session.session_name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteSession(session.session_id) },
      ]
    );
  };

  const renderItem = ({ item }: { item: ScanSession }) => {
    const cfg = STATUS_MAP[item.status] ?? STATUS_MAP['scanning'];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push({ pathname: '/review', params: { sessionId: item.session_id } })}
        activeOpacity={0.78}
      >
        {/* Top row */}
        <View style={styles.cardTop}>
          <View style={[styles.typeIcon, { backgroundColor: cfg.bg }]}>
            <Ionicons name="document-text" size={22} color={cfg.color} />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{item.session_name}</Text>
            <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
          </View>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={18} color={COLORS.error} />
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="people" size={14} color={COLORS.textMuted} />
            <Text style={styles.statVal}>{item.stats?.total_students || 0}</Text>
            <Text style={styles.statLabel}>students</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.stat}>
            <Ionicons name="documents" size={14} color={COLORS.textMuted} />
            <Text style={styles.statVal}>{item.stats?.total_pages || 0}</Text>
            <Text style={styles.statLabel}>pages</Text>
          </View>
          <View style={styles.spacer} />
          {/* Status badge */}
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={13} color={cfg.color} />
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          {/* Upload CTA */}
          {(item.status === 'ready' || item.status === 'failed') && (
            <TouchableOpacity
              style={styles.uploadCTA}
              onPress={() => router.push({ pathname: '/upload', params: { sessionId: item.session_id } })}
              activeOpacity={0.82}
            >
              <Ionicons name="cloud-upload" size={14} color="#fff" />
              <Text style={styles.uploadCTAText}>Upload</Text>
            </TouchableOpacity>
          )}
          {item.status === 'uploaded' && item.exam_id && (
            <TouchableOpacity
              style={styles.reviewCTA}
              onPress={() => router.push({ pathname: '/review-grading' as any, params: { examId: item.exam_id, sessionName: item.session_name } })}
              activeOpacity={0.82}
            >
              <Text style={styles.reviewCTAText}>Review</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Sessions</Text>
          <Text style={styles.headerSub}>{sessions.length} scan session{sessions.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/session-setup')} activeOpacity={0.82}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="folder-open-outline" size={52} color={COLORS.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <Text style={styles.emptySub}>Scan your first batch of answer papers to get started.</Text>
          <TouchableOpacity style={styles.emptyCTA} onPress={() => router.push('/session-setup')} activeOpacity={0.82}>
            <Ionicons name="camera" size={18} color="#fff" />
            <Text style={styles.emptyCTAText}>New Scan Session</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={item => item.session_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listPad}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
        />
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
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // List
  listPad: { padding: 16 },

  // Card
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  typeIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  cardDate: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  deleteBtn: { padding: 6 },

  // Divider
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginBottom: 12 },

  // Stats row
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statVal: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  statLabel: { fontSize: 11, color: COLORS.textMuted },
  statSep: { width: 1, height: 14, backgroundColor: COLORS.border, marginHorizontal: 10 },
  spacer: { flex: 1 },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusText: { fontSize: 11, fontWeight: '700' },

  uploadCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    marginLeft: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  uploadCTAText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  reviewCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    marginLeft: 8,
  },
  reviewCTAText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },

  // Empty state
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: COLORS.textLight, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  emptyCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyCTAText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
