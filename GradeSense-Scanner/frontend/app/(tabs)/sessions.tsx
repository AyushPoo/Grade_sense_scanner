import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, getBackendUrl } from '../../src/config';
import { useScanStore } from '../../src/store/scanStore';
import { useAuthStore } from '../../src/store/authStore';
import { ScanSession } from '../../src/types';
import { fetchManagedExams } from '../../src/api/manage';
import { ManagedExam } from '../../src/utils/manageData';
import { isReviewReadyExam } from '../../src/utils/gradingLifecycle';

const STATUS_MAP: Record<string, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; bg: string; label: string }> = {
  uploaded:  { icon: 'checkmark-circle', color: COLORS.success,  bg: COLORS.successLight,  label: 'Uploaded'    },
  completed: { icon: 'checkmark-circle', color: COLORS.success,  bg: COLORS.successLight,  label: 'Uploaded'    },
  grading:   { icon: 'sync-circle',      color: COLORS.primary,  bg: COLORS.primaryXLight, label: 'Grading'     },
  graded:    { icon: 'checkmark-circle', color: COLORS.success,  bg: COLORS.successLight,  label: 'Graded'      },
  syncing:   { icon: 'sync',             color: COLORS.primary,  bg: COLORS.primaryXLight, label: 'Syncing'     },
  sync_failed: { icon: 'alert-circle',   color: COLORS.error,    bg: COLORS.errorLight,    label: 'Sync failed' },
  ready:     { icon: 'time',             color: COLORS.warning,  bg: COLORS.warningLight,  label: 'Pending'     },
  uploading: { icon: 'cloud-upload',     color: COLORS.info,     bg: COLORS.infoLight,     label: 'Uploading...'  },
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
  const token = useAuthStore(s => s.sessionToken);
  const { savedSessions, deleteSession, fetchSessions, savedSubjects, fetchSubjects } = useScanStore();

  const [activeTab, setActiveTab] = useState<'drafts' | 'review'>('review');
  const [refreshing, setRefreshing] = useState(false);
  const [reviewExams, setReviewExams] = useState<ManagedExam[]>([]);
  const [loadingReviewExams, setLoadingReviewExams] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('All');
  const [selectedSubject, setSelectedSubject] = useState('All');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');

  const sessions = Array.isArray(savedSessions) ? savedSessions : [];

  const filteredSessions = React.useMemo(() => {
    let list = [...sessions];
    
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => s.session_name.toLowerCase().includes(q));
    }

    // Batch filter
    if (selectedBatch !== 'All') {
      list = list.filter(s => s.batch_name === selectedBatch);
    }

    // Subject filter
    if (selectedSubject !== 'All') {
      list = list.filter(s => {
        if (!s.subject_id) return false;
        const subj = savedSubjects.find(sub => sub.id === s.subject_id);
        const name = subj ? subj.name : 'Unknown Subject';
        return name === selectedSubject;
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'name') return a.session_name.localeCompare(b.session_name);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [sessions, searchQuery, selectedBatch, selectedSubject, sortBy, savedSubjects]);

  const filteredReviewExams = React.useMemo(() => {
    let list = [...reviewExams];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => 
        e.name.toLowerCase().includes(q) || 
        (e.subjectName && e.subjectName.toLowerCase().includes(q)) ||
        (e.batchName && e.batchName.toLowerCase().includes(q))
      );
    }
    if (selectedBatch !== 'All') {
      list = list.filter(e => e.batchName === selectedBatch);
    }
    if (selectedSubject !== 'All') {
      list = list.filter(e => e.subjectName === selectedSubject);
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const dateA = a.examDate ? new Date(a.examDate).getTime() : 0;
      const dateB = b.examDate ? new Date(b.examDate).getTime() : 0;
      return dateB - dateA;
    });
    return list;
  }, [reviewExams, searchQuery, selectedBatch, selectedSubject, sortBy]);

  const uniqueBatches = React.useMemo(() => {
    const set = new Set<string>();
    if (activeTab === 'review') {
      reviewExams.forEach(e => { if (e.batchName) set.add(e.batchName); });
    } else {
      sessions.forEach(s => { if (s.batch_name) set.add(s.batch_name); });
    }
    return ['All', ...Array.from(set)];
  }, [activeTab, reviewExams, sessions]);

  const uniqueSubjects = React.useMemo(() => {
    const set = new Set<string>();
    if (activeTab === 'review') {
      reviewExams.forEach(e => { if (e.subjectName) set.add(e.subjectName); });
    } else {
      sessions.forEach(s => {
        if (s.subject_id) {
          const subj = savedSubjects.find(sub => sub.id === s.subject_id);
          if (subj) set.add(subj.name);
        }
      });
    }
    return ['All', ...Array.from(set)];
  }, [activeTab, reviewExams, sessions, savedSubjects]);

  const loadReviewExams = useCallback(async () => {
    if (!token) return;
    setLoadingReviewExams(true);
    try {
      const exams = await fetchManagedExams({ backendUrl: getBackendUrl(), token });
      setReviewExams(exams.filter(exam => isReviewReadyExam(exam)));
    } catch (err) {
      console.error('Error fetching review-ready exams:', err);
    } finally {
      setLoadingReviewExams(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSessions().catch(() => {});
    fetchSubjects().catch(() => {});
  }, [fetchSessions, fetchSubjects]);

  useEffect(() => {
    if (activeTab === 'review' && reviewExams.length === 0) {
      loadReviewExams();
    }
  }, [activeTab, loadReviewExams, reviewExams.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'drafts') {
      try { await fetchSessions(); } catch { /* silent */ } finally { setRefreshing(false); }
    } else {
      await loadReviewExams();
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
    let cfg = STATUS_MAP[item.status] ?? STATUS_MAP['scanning'];
    if (item.status === 'uploading') {
      cfg = {
        ...cfg,
        label: `Uploading (${item.upload_progress || 0}%)`,
      };
    }

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (item.status === 'uploading' || item.status === 'syncing') {
            router.push({ pathname: '/upload', params: { sessionId: item.session_id } });
          } else {
            router.push({ pathname: '/review', params: { sessionId: item.session_id } });
          }
        }}
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
          {(item.status === 'uploaded' || item.status === 'grading' || item.status === 'graded') && item.exam_id && (
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

  const renderReviewExamItem = ({ item }: { item: ManagedExam }) => (
    <TouchableOpacity
      style={styles.reviewExamCard}
      onPress={() => router.push({ pathname: '/review-grading' as any, params: { examId: item.id, sessionName: item.name } })}
      activeOpacity={0.82}
    >
      <View style={styles.reviewExamIcon}>
        <Ionicons name="checkbox-outline" size={21} color={COLORS.success} />
      </View>
      <View style={styles.reviewExamBody}>
        <Text style={styles.reviewExamTitle} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.reviewExamMeta}>
          {item.submissionCount} papers - {item.averagePercentage ? `${item.averagePercentage}% avg` : `${item.totalMarks || 0} marks`}
        </Text>
      </View>
      <View style={styles.reviewExamCTA}>
        <Text style={styles.reviewExamCTAText}>Review</Text>
        <Ionicons name="chevron-forward" size={13} color="#fff" />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Review</Text>
          <Text style={styles.headerSub}>
            {activeTab === 'drafts'
              ? `${sessions.length} local draft${sessions.length !== 1 ? 's' : ''}`
              : `${reviewExams.length} exam${reviewExams.length !== 1 ? 's' : ''} ready`}
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
          onPress={() => {
            setActiveTab('drafts');
            setSelectedBatch('All');
            setSelectedSubject('All');
            setSearchQuery('');
          }}
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
          style={[styles.segmentBtn, activeTab === 'review' && styles.segmentBtnActive]}
          onPress={() => {
            setActiveTab('review');
            setSelectedBatch('All');
            setSelectedSubject('All');
            setSearchQuery('');
          }}
          activeOpacity={0.8}
        >
          <Ionicons
            name={activeTab === 'review' ? 'checkbox' : 'checkbox-outline'}
            size={16}
            color={activeTab === 'review' ? '#fff' : COLORS.textLight}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentText, activeTab === 'review' && styles.segmentTextActive]}>
            Review
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search & Sort Panel */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search-outline" size={18} color={COLORS.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={activeTab === 'drafts' ? "Search drafts..." : "Search exams, subjects..."}
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Sort Toggle */}
        <TouchableOpacity
          style={styles.sortToggle}
          onPress={() => setSortBy(prev => prev === 'date' ? 'name' : 'date')}
          activeOpacity={0.8}
        >
          <Ionicons name={sortBy === 'date' ? 'calendar-outline' : 'text-outline'} size={15} color={COLORS.primary} />
          <Text style={styles.sortToggleText}>
            {sortBy === 'date' ? 'Latest' : 'A-Z'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Dynamic Filters Row */}
      {(uniqueBatches.length > 2 || uniqueSubjects.length > 2) && (
        <View style={styles.filtersContainer}>
          {uniqueBatches.length > 2 && (
            <View style={styles.filterGroup}>
              <Text style={styles.filterGroupLabel}>Batch:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                {uniqueBatches.map(batchName => (
                  <TouchableOpacity
                    key={batchName}
                    style={[
                      styles.filterChip,
                      selectedBatch === batchName && styles.filterChipActive
                    ]}
                    onPress={() => setSelectedBatch(batchName)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedBatch === batchName && styles.filterChipTextActive
                      ]}
                    >
                      {batchName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {uniqueSubjects.length > 2 && (
            <View style={styles.filterGroup}>
              <Text style={styles.filterGroupLabel}>Subject:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                {uniqueSubjects.map(subjName => (
                  <TouchableOpacity
                    key={subjName}
                    style={[
                      styles.filterChip,
                      selectedSubject === subjName && styles.filterChipActive
                    ]}
                    onPress={() => setSelectedSubject(subjName)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedSubject === subjName && styles.filterChipTextActive
                      ]}
                    >
                      {subjName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

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
              <Text style={styles.emptyCTAText}>New Scan/Upload</Text>
            </TouchableOpacity>
          </View>
        ) : filteredSessions.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="search-outline" size={52} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No drafts found</Text>
            <Text style={styles.emptySub}>Try adjusting your search term.</Text>
          </View>
        ) : (
          <FlatList
            data={filteredSessions}
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
        loadingReviewExams && reviewExams.length === 0 ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loaderText}>Loading review-ready exams...</Text>
          </View>
        ) : reviewExams.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="checkbox-outline" size={52} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No exams ready yet</Text>
            <Text style={styles.emptySub}>Graded papers will appear here automatically after AI grading completes.</Text>
            <TouchableOpacity style={styles.emptyCTA} onPress={() => router.push('/session-setup')} activeOpacity={0.82}>
              <Ionicons name="scan" size={18} color="#fff" />
              <Text style={styles.emptyCTAText}>New Scan/Upload</Text>
            </TouchableOpacity>
          </View>
        ) : filteredReviewExams.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="search-outline" size={52} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No exams found</Text>
            <Text style={styles.emptySub}>Try adjusting your search queries or filter selections.</Text>
          </View>
        ) : (
          <FlatList
            data={filteredReviewExams}
            keyExtractor={item => item.id}
            renderItem={renderReviewExamItem}
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

  reviewExamCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 2,
    flexDirection: 'row',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  reviewExamIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.successLight,
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    marginRight: 12,
    width: 48,
  },
  reviewExamBody: {
    flex: 1,
  },
  reviewExamTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  reviewExamMeta: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  reviewExamCTA: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  reviewExamCTAText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
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
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    gap: 8,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 10,
    height: 40,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  sortToggleText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  filtersContainer: {
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 6,
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterGroupLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    width: 55,
  },
  filterScroll: {
    paddingRight: 16,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
});
