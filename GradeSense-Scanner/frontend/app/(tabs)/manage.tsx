import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';
import {
  archiveManagedExam,
  closeManagedExam,
  fetchManagedExams,
  fetchManagePerformance,
  publishManagedExam,
} from '../../src/api/manage';
import { AnalyticsPerformancePanel } from '../../src/components/manage/AnalyticsPerformancePanel';
import { ExamManagementPanel } from '../../src/components/manage/ExamManagementPanel';
import { ManagedExam, ManagePerformance } from '../../src/utils/manageData';
import { AIBrainRule, createAIBrainRule, fetchAIBrainRules } from '../../src/api/aiBrain';

interface TeacherOverview {
  examsCount: number;
  submissionsCount: number;
  reviewedCount: number;
  averagePercentage: number;
  recentExams: {
    id: string;
    name: string;
    examDate: string | null;
    totalMarks: number;
    status: string;
  }[];
}

interface Batch {
  batch_id: string;
  name: string;
  student_count: number;
}

interface Student {
  student_id: string;
  name: string;
  roll_number: string;
  email?: string;
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
  const { savedSessions, fetchSessions } = useScanStore();

  const [activeTab, setActiveTab] = useState<'analytics' | 'exams' | 'classroom' | 'brain' | 'reevaluation'>('exams');
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [performance, setPerformance] = useState<ManagePerformance | null>(null);
  const [managedExams, setManagedExams] = useState<ManagedExam[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [loadingExams, setLoadingExams] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [processingExamId, setProcessingExamId] = useState<string | null>(null);
  const [aiBrainRules, setAIBrainRules] = useState<AIBrainRule[]>([]);
  const [loadingAIBrain, setLoadingAIBrain] = useState(false);
  const [newBrainRule, setNewBrainRule] = useState('');
  const [savingBrainRule, setSavingBrainRule] = useState(false);

  // Classroom Management States
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [studentsByBatch, setStudentsByBatch] = useState<Record<string, Student[]>>({});
  const [loadingStudents, setLoadingStudents] = useState<string | null>(null);

  // Re-evaluation States
  const [reevaluations, setReevaluations] = useState<any[]>([]);
  const [loadingReevaluations, setLoadingReevaluations] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [activeReeval, setActiveReeval] = useState<any | null>(null);
  const [resolveAction, setResolveAction] = useState<'approved' | 'rejected'>('approved');
  const [teacherResponse, setTeacherResponse] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  // Modals
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [newBatchName, setNewBatchName] = useState('');
  
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentRoll, setNewStudentRoll] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');

  const localStats = React.useMemo(() => {
    const sessions = Array.isArray(savedSessions) ? savedSessions : [];
    return {
      sessions: sessions.length,
      uploaded: sessions.filter(s => s.status === 'uploaded').length,
      pending: sessions.filter(s => s.status === 'ready').length,
      pages: sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0),
    };
  }, [savedSessions]);

  const fetchOverview = useCallback(async (silent = false) => {
    if (!token) {
      setIsLoading(false);
      setIsOffline(true);
      return;
    }
    if (!silent) setIsLoading(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${getBackendUrl()}/api/v1/analytics/overview`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
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
  }, [token]);

  const fetchPerformanceInsights = useCallback(async () => {
    if (!token) return;
    setLoadingPerformance(true);
    try {
      const data = await fetchManagePerformance({ backendUrl: getBackendUrl(), token });
      setPerformance(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingPerformance(false);
    }
  }, [token]);

  const fetchExamManagement = useCallback(async () => {
    if (!token) return;
    setLoadingExams(true);
    try {
      const data = await fetchManagedExams({ backendUrl: getBackendUrl(), token });
      setManagedExams(data);
      setIsOffline(false);
    } catch (err) {
      console.error(err);
      setIsOffline(true);
    } finally {
      setLoadingExams(false);
      setRefreshing(false);
    }
  }, [token]);

  const fetchBatches = useCallback(async () => {
    if (!token) return;
    setLoadingBatches(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/batches`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setBatches(json.batches || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBatches(false);
      setRefreshing(false);
    }
  }, [token]);

  const fetchStudents = useCallback(async (batchId: string) => {
    if (!token) return;
    setLoadingStudents(batchId);
    try {
      const res = await fetch(`${getBackendUrl()}/api/batches/${batchId}/students`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setStudentsByBatch(prev => ({ ...prev, [batchId]: json.students || [] }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStudents(null);
    }
  }, [token]);

  const fetchReevaluations = useCallback(async () => {
    if (!token) return;
    setLoadingReevaluations(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/re-evaluations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setReevaluations(json.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReevaluations(false);
      setRefreshing(false);
    }
  }, [token]);

  const fetchAIBrain = useCallback(async () => {
    if (!token) return;
    setLoadingAIBrain(true);
    try {
      const data = await fetchAIBrainRules({ backendUrl: getBackendUrl(), token });
      setAIBrainRules(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAIBrain(false);
      setRefreshing(false);
    }
  }, [token]);

  const handleSaveBrainRule = async () => {
    if (!token || !newBrainRule.trim()) return;
    setSavingBrainRule(true);
    try {
      const created = await createAIBrainRule({
        backendUrl: getBackendUrl(),
        token,
        rule: newBrainRule.trim(),
      });
      setAIBrainRules(prev => [created, ...prev]);
      setNewBrainRule('');
    } catch (err: any) {
      Alert.alert('AI Brain not saved', err.message || 'Could not save this rule.');
    } finally {
      setSavingBrainRule(false);
    }
  };

  const handleResolveReeval = async () => {
    if (!activeReeval || !token) return;
    if (!teacherResponse.trim()) {
      Alert.alert('Error', 'Please enter a response/explanation for the student.');
      return;
    }
    setIsResolving(true);
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/re-evaluations/${activeReeval.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: resolveAction,
          teacherResponse: teacherResponse.trim()
        })
      });
      if (res.ok) {
        Alert.alert('Success', `Re-evaluation request resolved successfully.`);
        setShowResolveModal(false);
        setTeacherResponse('');
        setActiveReeval(null);
        fetchReevaluations();
      } else {
        const txt = await res.text();
        Alert.alert('Failed', `Could not resolve re-evaluation: ${txt}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsResolving(false);
    }
  };

  const replaceManagedExam = (exam: ManagedExam) => {
    setManagedExams(prev => prev.map(item => item.id === exam.id ? exam : item));
  };

  const handlePublishExam = (exam: ManagedExam) => {
    if (!token) return;
    Alert.alert(
      'Publish Results?',
      `Students will be able to see results for "${exam.name}".`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async () => {
            setProcessingExamId(exam.id);
            try {
              const updated = await publishManagedExam({ backendUrl: getBackendUrl(), token, examId: exam.id });
              replaceManagedExam(updated);
            } catch (err: any) {
              Alert.alert('Failed', err.message || 'Could not publish results.');
            } finally {
              setProcessingExamId(null);
            }
          },
        },
      ]
    );
  };

  const handleCloseExam = (exam: ManagedExam) => {
    if (!token) return;
    Alert.alert(
      'Close Exam?',
      `This will close "${exam.name}" while keeping submissions and files intact.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          onPress: async () => {
            setProcessingExamId(exam.id);
            try {
              const updated = await closeManagedExam({ backendUrl: getBackendUrl(), token, examId: exam.id });
              replaceManagedExam(updated);
            } catch (err: any) {
              Alert.alert('Failed', err.message || 'Could not close exam.');
            } finally {
              setProcessingExamId(null);
            }
          },
        },
      ]
    );
  };

  const handleArchiveExam = (exam: ManagedExam) => {
    if (!token) return;
    Alert.alert(
      'Delete Exam?',
      `This removes "${exam.name}" from the active roster. Historical database records are preserved by the backend.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setProcessingExamId(exam.id);
            try {
              await archiveManagedExam({ backendUrl: getBackendUrl(), token, examId: exam.id });
              setManagedExams(prev => prev.filter(item => item.id !== exam.id));
              await fetchSessions();
              fetchOverview();
              fetchPerformanceInsights();
            } catch (err: any) {
              Alert.alert('Failed', err.message || 'Could not delete exam.');
            } finally {
              setProcessingExamId(null);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchOverview();
      fetchPerformanceInsights();
    } else if (activeTab === 'exams') {
      fetchExamManagement();
    } else if (activeTab === 'classroom') {
      fetchBatches();
    } else if (activeTab === 'brain') {
      fetchAIBrain();
    } else if (activeTab === 'reevaluation') {
      fetchReevaluations();
    }
  }, [activeTab, fetchAIBrain, fetchBatches, fetchExamManagement, fetchOverview, fetchPerformanceInsights, fetchReevaluations]);

  const onRefresh = () => {
    setRefreshing(true);
    if (activeTab === 'analytics') {
      fetchOverview();
      fetchPerformanceInsights();
    } else if (activeTab === 'exams') {
      fetchExamManagement();
    } else if (activeTab === 'classroom') {
      fetchBatches();
      if (expandedBatchId) {
        fetchStudents(expandedBatchId);
      }
    } else if (activeTab === 'brain') {
      fetchAIBrain();
    } else if (activeTab === 'reevaluation') {
      fetchReevaluations();
    }
  };

  const handleAddBatch = async () => {
    if (!newBatchName.trim()) {
      Alert.alert('Error', 'Please enter a batch name');
      return;
    }
    try {
      const res = await fetch(`${getBackendUrl()}/api/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: newBatchName })
      });
      if (res.ok) {
        Alert.alert('Success', 'Batch created successfully!');
        setNewBatchName('');
        setShowAddBatchModal(false);
        fetchBatches();
      } else {
        const txt = await res.text();
        Alert.alert('Failed', `Could not create batch: ${txt}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleDeleteBatch = async (batchId: string, name: string) => {
    Alert.alert(
      'Delete Class Batch?',
      `Are you sure you want to delete "${name}"? All student assignments in this class will be detached.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(`${getBackendUrl()}/api/batches/${batchId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (res.ok) {
                Alert.alert('Success', 'Batch deleted successfully.');
                fetchBatches();
              }
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          }
        }
      ]
    );
  };

  const handleArchiveBatch = async (batchId: string, name: string) => {
    Alert.alert(
      'Archive Batch?',
      `Archive "${name}"? Historical exams and students will remain available from the webapp archive.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            try {
              const res = await fetch(`${getBackendUrl()}/api/batches/${batchId}/archive`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (res.ok) {
                Alert.alert('Success', 'Batch archived successfully.');
                fetchBatches();
              } else {
                const txt = await res.text();
                Alert.alert('Failed', `Could not archive batch: ${txt}`);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          }
        }
      ]
    );
  };

  const handleAddStudent = async () => {
    if (!newStudentName.trim() || !newStudentRoll.trim() || !selectedBatchId) {
      Alert.alert('Error', 'Name and Roll Number are required.');
      return;
    }
    try {
      const res = await fetch(`${getBackendUrl()}/api/batches/${selectedBatchId}/students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newStudentName,
          rollNumber: newStudentRoll,
          email: newStudentEmail || undefined
        })
      });
      if (res.ok) {
        Alert.alert('Success', 'Student added successfully!');
        setNewStudentName('');
        setNewStudentRoll('');
        setNewStudentEmail('');
        setShowAddStudentModal(false);
        fetchStudents(selectedBatchId);
        fetchBatches();
      } else {
        const txt = await res.text();
        Alert.alert('Failed', `Could not invite student: ${txt}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleDeleteStudent = async (batchId: string, studentId: string, name: string) => {
    Alert.alert(
      'Remove Student?',
      `Are you sure you want to remove "${name}" from this batch?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(`${getBackendUrl()}/api/batches/${batchId}/students/${studentId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (res.ok) {
                Alert.alert('Success', 'Student removed successfully.');
                fetchStudents(batchId);
                fetchBatches();
              }
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          }
        }
      ]
    );
  };

  const toggleBatchExpand = (batchId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
    } else {
      setExpandedBatchId(batchId);
      if (!studentsByBatch[batchId]) {
        fetchStudents(batchId);
      }
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Manage</Text>
          <Text style={styles.headerSub}>
            {activeTab === 'exams'
                ? 'Publish, close, and review exams'
                : activeTab === 'classroom'
                  ? 'Manage batches and students'
                  : activeTab === 'brain'
                    ? 'Synced AI grading memory'
                    : 'Student grade re-evaluation requests'}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'exams' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('exams')}
          activeOpacity={0.8}
        >
          <Ionicons
            name={activeTab === 'exams' ? 'documents' : 'documents-outline'}
            size={16}
            color={activeTab === 'exams' ? '#fff' : COLORS.textLight}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentText, activeTab === 'exams' && styles.segmentTextActive]}>
            Exams
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'classroom' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('classroom')}
          activeOpacity={0.8}
        >
          <Ionicons 
            name={activeTab === 'classroom' ? 'people' : 'people-outline'} 
            size={16} 
            color={activeTab === 'classroom' ? '#fff' : COLORS.textLight} 
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentText, activeTab === 'classroom' && styles.segmentTextActive]}>
            Roster
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'reevaluation' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('reevaluation')}
          activeOpacity={0.8}
        >
          <Ionicons 
            name={activeTab === 'reevaluation' ? 'alert-circle' : 'alert-circle-outline'} 
            size={16} 
            color={activeTab === 'reevaluation' ? '#fff' : COLORS.textLight} 
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentText, activeTab === 'reevaluation' && styles.segmentTextActive]}>
            Re-evals
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loaderText}>Loading dashboard...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {activeTab === 'analytics' ? (
            // ==================== ANALYTICS VIEW ====================
            <View>
              {isOffline && (
                <TouchableOpacity 
                  style={styles.offlineBanner}
                  onPress={() => fetchOverview(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cloud-offline" size={16} color={COLORS.warning} />
                  <Text style={styles.offlineText}>Could not reach server – showing local data</Text>
                  <View style={{ backgroundColor: COLORS.warning, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Retry</Text>
                  </View>
                </TouchableOpacity>
              )}

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

              <Text style={styles.sectionLabel}>SYNCED PERFORMANCE</Text>
              <AnalyticsPerformancePanel performance={performance} isLoading={loadingPerformance} />

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
            </View>
          ) : activeTab === 'exams' ? (
            // ==================== EXAM MANAGEMENT VIEW ====================
            <ExamManagementPanel
              exams={managedExams}
              isLoading={loadingExams}
              processingExamId={processingExamId}
              onReview={(exam) => router.push({ pathname: '/review-grading' as any, params: { examId: exam.id, sessionName: exam.name } })}
              onPublish={handlePublishExam}
              onClose={handleCloseExam}
              onArchive={handleArchiveExam}
              onCreateExam={() => router.push('/session-setup')}
            />
          ) : activeTab === 'classroom' ? (
            // ==================== CLASSROOM MANAGEMENT VIEW ====================
            <View>
              <View style={styles.classroomHeader}>
                <Text style={styles.sectionLabel}>BATCHES</Text>
                <TouchableOpacity
                  style={styles.addClassBtn}
                  onPress={() => setShowAddBatchModal(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addClassBtnText}>Add Class</Text>
                </TouchableOpacity>
              </View>

              {loadingBatches ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 20 }} />
              ) : batches.length === 0 ? (
                <View style={styles.emptyClassRoster}>
                  <Ionicons name="school-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.noBatchesText}>No batches created yet.</Text>
                </View>
              ) : (
                batches.map(batch => {
                  const isExpanded = expandedBatchId === batch.batch_id;
                  const students = studentsByBatch[batch.batch_id] || [];

                  return (
                    <View key={batch.batch_id} style={styles.manageCard}>
                      <TouchableOpacity
                        style={styles.manageHeader}
                        onPress={() => toggleBatchExpand(batch.batch_id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.manageInfo}>
                          <Text style={styles.manageName}>{batch.name}</Text>
                          <Text style={styles.manageSubtitle}>{batch.student_count || 0} students</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <TouchableOpacity
                            onPress={() => handleArchiveBatch(batch.batch_id, batch.name)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="archive-outline" size={18} color={COLORS.warning} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeleteBatch(batch.batch_id, batch.name)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                          </TouchableOpacity>
                          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={COLORS.textLight} />
                        </View>
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.studentsList}>
                          <View style={styles.studentListHeader}>
                            <Text style={styles.studentListTitle}>Student Roster</Text>
                            <TouchableOpacity
                              style={styles.addStudentBtn}
                              onPress={() => {
                                setSelectedBatchId(batch.batch_id);
                                setShowAddStudentModal(true);
                              }}
                            >
                              <Ionicons name="person-add" size={14} color={COLORS.primary} />
                              <Text style={styles.addStudentBtnText}>Add Student</Text>
                            </TouchableOpacity>
                          </View>

                          {loadingStudents === batch.batch_id && (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 12 }} />
                          )}

                          {students.length === 0 && loadingStudents !== batch.batch_id && (
                            <Text style={styles.noStudentsText}>Roster is empty. Add your first student.</Text>
                          )}

                          {students.map(std => (
                            <View key={std.student_id} style={styles.studentItem}>
                              <View style={styles.studentAvatar}>
                                <Text style={styles.studentAvatarText}>{std.name[0]?.toUpperCase()}</Text>
                              </View>
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.studentNameText}>{std.name}</Text>
                                <Text style={styles.studentMetaText}>Roll No: {std.roll_number} {std.email ? `• ${std.email}` : ''}</Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => handleDeleteStudent(batch.batch_id, std.student_id, std.name)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          ) : activeTab === 'brain' ? (
            <View>
              <Text style={styles.sectionLabel}>GLOBAL GRADING MEMORY</Text>
              <View style={styles.brainComposer}>
                <TextInput
                  value={newBrainRule}
                  onChangeText={setNewBrainRule}
                  placeholder="Example: Award method marks when the final answer is slightly off due to arithmetic."
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  style={styles.brainInput}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.brainSaveBtn, (!newBrainRule.trim() || savingBrainRule) && styles.brainSaveBtnDisabled]}
                  onPress={handleSaveBrainRule}
                  disabled={!newBrainRule.trim() || savingBrainRule}
                  activeOpacity={0.82}
                >
                  {savingBrainRule ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="save-outline" size={16} color="#fff" />
                      <Text style={styles.brainSaveText}>Save Rule</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionLabel}>LEARNED RULES</Text>
              {loadingAIBrain ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 20 }} />
              ) : aiBrainRules.length === 0 ? (
                <View style={styles.emptyClassRoster}>
                  <Ionicons name="bulb-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.noBatchesText}>No AI Brain rules saved yet.</Text>
                </View>
              ) : (
                aiBrainRules.map(rule => (
                  <View key={rule.id} style={styles.brainRuleCard}>
                    <View style={styles.brainRuleTop}>
                      <View style={[styles.reevalBadge, { backgroundColor: rule.scope === 'global' ? COLORS.infoLight : COLORS.primaryXLight }]}>
                        <Text style={[styles.reevalBadgeText, { color: rule.scope === 'global' ? COLORS.info : COLORS.primary }]}>
                          {rule.scope === 'global' ? 'Global' : `Q${rule.questionNumber || '-'}`}
                        </Text>
                      </View>
                      <Text style={styles.brainRuleDate}>{rule.createdAt ? new Date(rule.createdAt).toLocaleDateString() : ''}</Text>
                    </View>
                    <Text style={styles.brainRuleText}>{rule.teacherCorrection}</Text>
                  </View>
                ))
              )}
            </View>
          ) : (
            // ==================== RE-EVALUATION VIEW ====================
            <View>
              <Text style={styles.sectionLabel}>RE-EVALUATION REQUESTS</Text>
              {loadingReevaluations ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 20 }} />
              ) : reevaluations.length === 0 ? (
                <View style={styles.emptyClassRoster}>
                  <Ionicons name="alert-circle-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.noBatchesText}>No re-evaluations found.</Text>
                </View>
              ) : (
                reevaluations.map(item => {
                  const isPending = item.status === 'pending';
                  const statusColor = isPending ? COLORS.warning : item.status === 'rejected' ? COLORS.error : COLORS.success;
                  const statusBg = isPending ? COLORS.warningLight : item.status === 'rejected' ? COLORS.errorLight : COLORS.successLight;
                  
                  let qNumbers: string[] = [];
                  try {
                    qNumbers = typeof item.questionNumbersJson === 'string' 
                      ? JSON.parse(item.questionNumbersJson) 
                      : (Array.isArray(item.questionNumbersJson) ? item.questionNumbersJson : []);
                  } catch {}

                  return (
                    <View key={item.id} style={styles.reevalCard}>
                      <View style={styles.reevalHeader}>
                        <View style={styles.reevalAvatar}>
                          <Text style={styles.reevalAvatarText}>
                            {item.studentName ? item.studentName[0].toUpperCase() : 'S'}
                          </Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.reevalStudentName}>{item.studentName}</Text>
                          <Text style={styles.reevalExamName}>{item.examName || 'Exam Paper'}</Text>
                        </View>
                        <View style={[styles.reevalBadge, { backgroundColor: statusBg }]}>
                          <Text style={[styles.reevalBadgeText, { color: statusColor }]}>
                            {item.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      {/* Question tags */}
                      {qNumbers.length > 0 && (
                        <View style={styles.reevalQuestionsRow}>
                          <Text style={styles.reevalQuestionsLabel}>Questions: </Text>
                          {qNumbers.map((q: string) => (
                            <View key={q} style={styles.reevalQuestionTag}>
                              <Text style={styles.reevalQuestionTagText}>{q}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Reason */}
                      <View style={styles.reevalReasonBox}>
                        <Text style={styles.reevalReasonText}>{item.reason}</Text>
                      </View>

                      {/* Footer actions / responses */}
                      {isPending ? (
                        <TouchableOpacity
                          style={styles.reevalResolveBtn}
                          onPress={() => {
                            setActiveReeval(item);
                            setResolveAction('approved');
                            setTeacherResponse('');
                            setShowResolveModal(true);
                          }}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                          <Text style={styles.reevalResolveBtnText}>Resolve Request</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.reevalResponseBox}>
                          <Text style={styles.reevalResponseTitle}>Teacher Response:</Text>
                          <Text style={styles.reevalResponseText}>{item.teacherResponse || 'Grade confirmed.'}</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Add Batch Modal */}
      <Modal visible={showAddBatchModal} transparent animationType="slide" onRequestClose={() => setShowAddBatchModal(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.sheetTitle}>Create Class Batch</Text>
            <Text style={modalStyles.sheetSub}>Enter the name for the new batch/class.</Text>
            <TextInput
              style={modalStyles.input}
              value={newBatchName}
              onChangeText={setNewBatchName}
              placeholder="e.g. Class 10 - Section B"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddBatch}
            />
            <View style={modalStyles.buttons}>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => setShowAddBatchModal(false)}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.saveBtn]} onPress={handleAddBatch}>
                <Text style={modalStyles.saveText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Student Modal */}
      <Modal visible={showAddStudentModal} transparent animationType="slide" onRequestClose={() => setShowAddStudentModal(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.sheetTitle}>Add Student to Roster</Text>
            <Text style={modalStyles.sheetSub}>Enter student details to add to class batch.</Text>
            
            <TextInput
              style={modalStyles.input}
              value={newStudentName}
              onChangeText={setNewStudentName}
              placeholder="Full Name"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
            />
            <TextInput
              style={modalStyles.input}
              value={newStudentRoll}
              onChangeText={setNewStudentRoll}
              placeholder="Roll Number (e.g. 15)"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
            />
            <TextInput
              style={modalStyles.input}
              value={newStudentEmail}
              onChangeText={setNewStudentEmail}
              placeholder="Email Address (Optional)"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={modalStyles.buttons}>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => setShowAddStudentModal(false)}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.saveBtn]} onPress={handleAddStudent}>
                <Text style={modalStyles.saveText}>Add Student</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Resolve Re-evaluation Modal */}
      <Modal visible={showResolveModal} transparent animationType="slide" onRequestClose={() => setShowResolveModal(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.sheetTitle}>Resolve Re-evaluation</Text>
            <Text style={modalStyles.sheetSub}>
              Review student request and choose to approve marks update or reject it.
            </Text>

            <Text style={styles.fieldLabel}>DECISION</Text>
            <View style={styles.selectOptions}>
              <TouchableOpacity
                style={[styles.selectOption, resolveAction === 'approved' && { backgroundColor: COLORS.success, borderColor: COLORS.success }]}
                onPress={() => setResolveAction('approved')}
              >
                <Text style={[styles.selectOptionText, resolveAction === 'approved' && { color: '#fff' }]}>
                  APPROVE CHANGES
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.selectOption, resolveAction === 'rejected' && { backgroundColor: COLORS.error, borderColor: COLORS.error }]}
                onPress={() => setResolveAction('rejected')}
              >
                <Text style={[styles.selectOptionText, resolveAction === 'rejected' && { color: '#fff' }]}>
                  REJECT / CONFIRM GRADE
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>EXPLANATION FOR STUDENT</Text>
            <TextInput
              style={[modalStyles.input, { height: 100, textAlignVertical: 'top' }]}
              value={teacherResponse}
              onChangeText={setTeacherResponse}
              placeholder="e.g. Recalculated total, updated marks. OR checked paper, grade stands because..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={4}
            />

            <View style={modalStyles.buttons}>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => setShowResolveModal(false)}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.btn, modalStyles.saveBtn, { backgroundColor: resolveAction === 'approved' ? COLORS.success : COLORS.error }]}
                onPress={handleResolveReeval}
                disabled={isResolving}
              >
                {isResolving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={modalStyles.saveText}>Submit Decision</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  headerTitle: { fontSize: 23, fontWeight: '800', color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Segmented Control
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 6,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 38,
    minWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 8,
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
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
    lineHeight: 16,
  },
  segmentTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // Loader
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loaderText: { fontSize: 14, color: COLORS.textLight },

  // Re-evaluations styles
  reevalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 1,
    padding: 16,
    marginBottom: 12,
  },
  reevalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reevalAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reevalAvatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  reevalStudentName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  reevalExamName: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  reevalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reevalBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  reevalQuestionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 4,
  },
  reevalQuestionsLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  reevalQuestionTag: {
    backgroundColor: COLORS.infoLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reevalQuestionTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.info,
  },
  reevalReasonBox: {
    backgroundColor: COLORS.backgroundDark,
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  reevalReasonText: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  reevalResolveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  reevalResolveBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  reevalResponseBox: {
    backgroundColor: COLORS.successLight + '20',
    borderWidth: 1,
    borderColor: COLORS.success + '30',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  reevalResponseTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 4,
  },
  reevalResponseText: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textLight,
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 2,
  },
  selectOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  selectOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textLight,
  },

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

  // Classroom Tab Headers
  classroomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addClassBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  addClassBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyClassRoster: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  noBatchesText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 8,
  },

  // Classroom Management cards
  manageCard: {
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
    marginBottom: 10,
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  manageInfo: { flex: 1 },
  manageName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  manageSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Students Expand List
  studentsList: {
    backgroundColor: COLORS.backgroundDark,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    padding: 14,
    gap: 8,
  },
  studentListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  studentListTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textLight,
    letterSpacing: 0.5,
  },
  addStudentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  addStudentBtnText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  noStudentsText: {
    fontSize: 13,
    color: COLORS.textMuted,
    paddingVertical: 8,
    textAlign: 'center',
  },
  brainComposer: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 22,
    padding: 14,
  },
  brainInput: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 104,
    padding: 0,
  },
  brainSaveBtn: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  brainSaveBtnDisabled: {
    opacity: 0.5,
  },
  brainSaveText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  brainRuleCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  brainRuleTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brainRuleDate: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  brainRuleText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  studentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primaryXLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  studentAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  studentNameText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  studentMetaText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },

});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
  },
  handle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  sheetSub: { fontSize: 14, color: COLORS.textLight, lineHeight: 20, marginBottom: 20 },
  input: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  cancelBtn: { backgroundColor: COLORS.surfaceElevated, borderWidth: 1, borderColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.primary, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  cancelText: { fontSize: 15, fontWeight: '600', color: COLORS.textLight },
  saveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
