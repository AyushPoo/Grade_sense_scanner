import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, getBackendUrl } from '../../src/config';
import { useScanStore } from '../../src/store/scanStore';
import { useAuthStore } from '../../src/store/authStore';
import { ScanSession } from '../../src/types';

// Enable layout animation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

interface Batch {
  batch_id: string;
  name: string;
  student_count: number;
}

interface Exam {
  id: string;
  name: string;
  subjectId: string;
  totalMarks: number;
  examDate: string | null;
  status: string;
}

export default function SessionsScreen() {
  const router = useRouter();
  const token = useAuthStore(s => s.sessionToken);
  const { savedSessions, deleteSession, fetchSessions } = useScanStore();

  const [activeTab, setActiveTab] = useState<'drafts' | 'batches'>('drafts');
  const [refreshing, setRefreshing] = useState(false);
  
  // Batches state
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [examsByBatch, setExamsByBatch] = useState<Record<string, Exam[]>>({});
  const [loadingExams, setLoadingExams] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions().catch(() => {});
    if (activeTab === 'batches') {
      loadBatches();
    }
  }, [activeTab]);

  const sessions = Array.isArray(savedSessions) ? savedSessions : [];

  const loadBatches = async () => {
    if (!token) return;
    setLoadingBatches(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/batches`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setBatches(json.batches || []);
      } else {
        console.warn('Failed to load batches');
      }
    } catch (err) {
      console.error('Error fetching batches:', err);
    } finally {
      setLoadingBatches(false);
      setRefreshing(false);
    }
  };

  const loadExamsForBatch = async (batchId: string) => {
    if (!token) return;
    setLoadingExams(batchId);
    try {
      const res = await fetch(`${getBackendUrl()}/api/batches/${batchId}/exams`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setExamsByBatch(prev => ({ ...prev, [batchId]: json.exams || [] }));
      }
    } catch (err) {
      console.error('Error fetching exams for batch:', err);
    } finally {
      setLoadingExams(null);
    }
  };

  const toggleBatchExpand = (batchId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
    } else {
      setExpandedBatchId(batchId);
      if (!examsByBatch[batchId]) {
        loadExamsForBatch(batchId);
      }
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'drafts') {
      try { await fetchSessions(); } catch { /* silent */ } finally { setRefreshing(false); }
    } else {
      await loadBatches();
      if (expandedBatchId) {
        await loadExamsForBatch(expandedBatchId);
      }
    }
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

  const renderDraftItem = ({ item }: { item: ScanSession }) => {
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

  const renderBatchItem = ({ item }: { item: Batch }) => {
    const isExpanded = expandedBatchId === item.batch_id;
    const exams = examsByBatch[item.batch_id] || [];

    return (
      <View style={styles.batchCard}>
        <TouchableOpacity
          style={styles.batchHeader}
          onPress={() => toggleBatchExpand(item.batch_id)}
          activeOpacity={0.7}
        >
          <View style={[styles.batchIconWrap, { backgroundColor: COLORS.primaryXLight }]}>
            <Ionicons name="people-circle" size={24} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.batchName}>{item.name}</Text>
            <Text style={styles.batchSubtitle}>{item.student_count || 0} enrolled students</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={COLORS.textLight}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.examsList}>
            <View style={styles.examsListHeader}>
              <Text style={styles.examsListTitle}>Class Exams</Text>
              {loadingExams === item.batch_id && <ActivityIndicator size="small" color={COLORS.primary} />}
            </View>

            {exams.length === 0 && loadingExams !== item.batch_id && (
              <Text style={styles.noExamsText}>No exams synced for this batch yet.</Text>
            )}

            {exams.map(exam => (
              <TouchableOpacity
                key={exam.id}
                style={styles.examItem}
                onPress={() => router.push({ pathname: '/review-grading' as any, params: { examId: exam.id, sessionName: exam.name } })}
              >
                <View style={styles.examIconCircle}>
                  <Ionicons name="document-text" size={16} color={COLORS.info} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.examNameText}>{exam.name}</Text>
                  <Text style={styles.examMetaText}>
                    Marks: {exam.totalMarks} • Date: {exam.examDate ? formatDate(exam.examDate) : 'N/A'}
                  </Text>
                </View>
                <View style={styles.examReviewButton}>
                  <Text style={styles.examReviewBtnText}>Review</Text>
                  <Ionicons name="arrow-forward" size={12} color="#fff" />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Sessions</Text>
          <Text style={styles.headerSub}>
            {activeTab === 'drafts' 
              ? `${sessions.length} local draft${sessions.length !== 1 ? 's' : ''}` 
              : `${batches.length} active class${batches.length !== 1 ? 'es' : ''}`
            }
          </Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/session-setup')} activeOpacity={0.82}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'drafts' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('drafts')}
          activeOpacity={0.8}
        >
          <Ionicons 
            name={activeTab === 'drafts' ? 'folder' : 'folder-outline'} 
            size={16} 
            color={activeTab === 'drafts' ? '#fff' : COLORS.textLight} 
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentText, activeTab === 'drafts' && styles.segmentTextActive]}>
            Local Drafts
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'batches' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('batches')}
          activeOpacity={0.8}
        >
          <Ionicons 
            name={activeTab === 'batches' ? 'people' : 'people-outline'} 
            size={16} 
            color={activeTab === 'batches' ? '#fff' : COLORS.textLight} 
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentText, activeTab === 'batches' && styles.segmentTextActive]}>
            Class Batches
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'drafts' ? (
        sessions.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="folder-open-outline" size={52} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No drafts yet</Text>
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
            renderItem={renderDraftItem}
            contentContainerStyle={styles.listPad}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
            }
          />
        )
      ) : (
        loadingBatches ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loaderText}>Loading class batches...</Text>
          </View>
        ) : batches.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="people-outline" size={52} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No batches found</Text>
            <Text style={styles.emptySub}>Add class batches and students in the Analytics & Manage tab first.</Text>
          </View>
        ) : (
          <FlatList
            data={batches}
            keyExtractor={item => item.batch_id}
            renderItem={renderBatchItem}
            contentContainerStyle={styles.listPad}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
            }
          />
        )
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

  // Segmented Control
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 9,
  },
  segmentBtnActive: {
    backgroundColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  segmentTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // List
  listPad: { padding: 16 },

  // Loader
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loaderText: { fontSize: 14, color: COLORS.textLight },

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

  // Batches list items
  batchCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 1,
    overflow: 'hidden',
  },
  batchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  batchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  batchName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  batchSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  
  examsList: {
    backgroundColor: COLORS.backgroundDark,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    padding: 14,
    gap: 8,
  },
  examsListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  examsListTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textLight,
    letterSpacing: 0.5,
  },
  noExamsText: {
    fontSize: 13,
    color: COLORS.textMuted,
    paddingVertical: 8,
    textAlign: 'center',
  },
  examItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  examIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.infoLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  examNameText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  examMetaText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  examReviewButton: {
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
  examReviewBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },

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
