import React, { useCallback, useRef, useState, useEffect } from 'react';
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
  Platform,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS, getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';
import {
  archiveManagedBatch,
  archiveManagedExam,
  closeManagedExam,
  createBatchStudent,
  createManagedBatch,
  deleteBatchStudent,
  deleteManagedBatch,
  fetchBatchStudents,
  fetchManagedBatches,
  fetchManagedExams,
  fetchManagePerformance,
  publishManagedExam,
  updateManagedBatch,
  updateBatchStudent,
  updateManagedExam,
  replaceExamFile,
  regradeExam,
} from '../../src/api/manage';
import { AnalyticsPerformancePanel } from '../../src/components/manage/AnalyticsPerformancePanel';
import { ExamManagementPanel } from '../../src/components/manage/ExamManagementPanel';
import { ExportModal } from '../../src/components/review/ExportModal';
import {
  ManagedRosterStudent,
  StudentReportModal,
  StudentProfileUpdateInput,
} from '../../src/components/manage/StudentReportModal';
import { ManagedBatch, ManagedExam, ManagePerformance } from '../../src/utils/manageData';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';

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

type Batch = ManagedBatch;

type Student = ManagedRosterStudent;

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

  const [activeTab, setActiveTab] = useState<'analytics' | 'exams' | 'classroom'>('exams');
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [performance, setPerformance] = useState<ManagePerformance | null>(null);
  const [managedExams, setManagedExams] = useState<ManagedExam[]>([]);
  const managedExamsRef = useRef<ManagedExam[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [loadingExams, setLoadingExams] = useState(false);
  const [examLoadError, setExamLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [processingExamId, setProcessingExamId] = useState<string | null>(null);

  // Export states
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportExamId, setExportExamId] = useState('');
  const [exportExamName, setExportExamName] = useState('');

  const handleExportExam = (exam: ManagedExam) => {
    setExportExamId(exam.id);
    setExportExamName(exam.name);
    setShowExportModal(true);
  };
  // Classroom Management States
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [studentsByBatch, setStudentsByBatch] = useState<Record<string, Student[]>>({});
  const [loadingStudents, setLoadingStudents] = useState<string | null>(null);
  const [selectedStudentReport, setSelectedStudentReport] = useState<Student | null>(null);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [classroomSearchQuery, setClassroomSearchQuery] = useState('');

  // Modals
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [newBatchName, setNewBatchName] = useState('');
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [editBatchName, setEditBatchName] = useState('');
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentRoll, setNewStudentRoll] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');

  // Edit Exam Modal States
  const [selectedEditExam, setSelectedEditExam] = useState<ManagedExam | null>(null);
  const [editExamTitle, setEditExamTitle] = useState('');
  const [editExamDate, setEditExamDate] = useState('');
  const [editExamMarks, setEditExamMarks] = useState('');
  const [isSavingExam, setIsSavingExam] = useState(false);
  const [isReplacingQP, setIsReplacingQP] = useState(false);
  const [isReplacingMA, setIsReplacingMA] = useState(false);
  const [isRegrading, setIsRegrading] = useState(false);

  const localStats = React.useMemo(() => {
    const sessions = Array.isArray(savedSessions) ? savedSessions : [];
    return {
      sessions: sessions.length,
      uploaded: sessions.filter(s => s.status === 'uploaded').length,
      pending: sessions.filter(s => s.status === 'ready').length,
      pages: sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0),
    };
  }, [savedSessions]);

  useEffect(() => {
    managedExamsRef.current = managedExams;
  }, [managedExams]);

  const fetchOverview = useCallback(async (silent = false) => {
    if (!token) {
      setIsLoading(false);
      setIsOffline(true);
      return;
    }
    if (!silent) setIsLoading(true);
    try {
      const res = await fetchWithTimeout(`${getBackendUrl()}/api/v1/analytics/overview`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Bypass-Tunnel-Reminder': 'true' },
      }, 8000);
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
    setLoadingExams(managedExamsRef.current.length === 0);
    try {
      const data = await fetchManagedExams({ backendUrl: getBackendUrl(), token });
      setManagedExams(data);
      setExamLoadError(null);
      setIsOffline(false);
    } catch (err: any) {
      console.error(err);
      setExamLoadError(err?.message || 'The backend did not respond in time. Pull to retry.');
      setIsOffline(true);
    } finally {
      setLoadingExams(false);
      setRefreshing(false);
    }
  }, [token]);

  const fetchStudentsSilent = useCallback(async (batchId: string) => {
    if (!token) return;
    try {
      const students = await fetchBatchStudents({ backendUrl: getBackendUrl(), token, batchId });
      setStudentsByBatch(prev => ({ ...prev, [batchId]: students }));
    } catch (err) {
      console.error('Silent load failed for batch:', batchId, err);
    }
  }, [token]);

  const fetchBatches = useCallback(async () => {
    if (!token) return;
    setLoadingBatches(true);
    try {
      const data = await fetchManagedBatches({ backendUrl: getBackendUrl(), token });
      setBatches(data);
      // Prefetch students in background to support global search on classroom tab
      for (const batch of data) {
        fetchStudentsSilent(batch.batch_id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBatches(false);
      setRefreshing(false);
    }
  }, [token, fetchStudentsSilent]);

  const fetchStudents = useCallback(async (batchId: string) => {
    if (!token) return;
    setLoadingStudents(batchId);
    try {
      const students = await fetchBatchStudents({ backendUrl: getBackendUrl(), token, batchId });
      setStudentsByBatch(prev => ({ ...prev, [batchId]: students }));
      setBatches(prev => prev.map(batch => (
        batch.batch_id === batchId
          ? { ...batch, student_count: students.length, studentCount: students.length }
          : batch
      )));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStudents(null);
    }
  }, [token]);

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

  const handleEditExam = (exam: ManagedExam) => {
    setSelectedEditExam(exam);
    setEditExamTitle(exam.name);
    setEditExamDate(exam.examDate || '');
    setEditExamMarks(exam.totalMarks?.toString() || '');
  };

  const handleUpdateExamMetadata = async () => {
    if (!selectedEditExam || !token) return;
    const cleanTitle = editExamTitle.trim();
    const cleanDate = editExamDate.trim();
    const marksNumber = Number(editExamMarks);

    if (!cleanTitle) {
      Alert.alert('Title required', 'Please enter an exam title.');
      return;
    }
    if (cleanDate && !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      Alert.alert('Invalid Date', 'Date must be in YYYY-MM-DD format.');
      return;
    }
    if (isNaN(marksNumber) || marksNumber <= 0) {
      Alert.alert('Invalid Marks', 'Total marks must be a positive number.');
      return;
    }

    setIsSavingExam(true);
    try {
      const updated = await updateManagedExam(
        { backendUrl: getBackendUrl(), token, examId: selectedEditExam.id },
        { name: cleanTitle, examDate: cleanDate || null, totalMarks: marksNumber }
      );
      replaceManagedExam(updated);
      setSelectedEditExam(null);
      Alert.alert('Success', 'Exam details updated successfully.');
      fetchExamManagement();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update exam details.');
    } finally {
      setIsSavingExam(false);
    }
  };

  const handleReplaceQP = async () => {
    if (!selectedEditExam || !token) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setIsReplacingQP(true);
      
      const response = await replaceExamFile(
        { backendUrl: getBackendUrl(), token, examId: selectedEditExam.id },
        'question_paper',
        asset.uri,
        asset.name || 'qp.pdf',
        asset.mimeType || 'application/pdf'
      );
      
      if (response.status === 'success') {
        Alert.alert('Success', 'Question Paper replaced successfully.');
        fetchExamManagement();
      } else {
        throw new Error('Failed to replace Question Paper.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not replace Question Paper.');
    } finally {
      setIsReplacingQP(false);
    }
  };

  const handleReplaceMA = async () => {
    if (!selectedEditExam || !token) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setIsReplacingMA(true);
      
      const response = await replaceExamFile(
        { backendUrl: getBackendUrl(), token, examId: selectedEditExam.id },
        'model_answer',
        asset.uri,
        asset.name || 'model_answer.pdf',
        asset.mimeType || 'application/pdf'
      );
      
      setIsReplacingMA(false);

      if (response.status === 'success') {
        Alert.alert(
          'Model Answer Replaced',
          'Model Answer updated successfully. Would you like to regrade all existing student submissions now using this new answer key?',
          [
            { text: 'No', style: 'cancel', onPress: () => fetchExamManagement() },
            {
              text: 'Yes, Regrade',
              onPress: async () => {
                setIsRegrading(true);
                try {
                  await regradeExam({ backendUrl: getBackendUrl(), token, examId: selectedEditExam!.id });
                  Alert.alert('Success', 'Regrading triggered. Results will update in a few minutes.');
                  fetchExamManagement();
                } catch (regradeErr: any) {
                  Alert.alert('Regrade Failed', regradeErr.message || 'Could not trigger regrading.');
                } finally {
                  setIsRegrading(false);
                }
              }
            }
          ]
        );
      } else {
        throw new Error('Failed to replace Model Answer.');
      }
    } catch (err: any) {
      setIsReplacingMA(false);
      Alert.alert('Error', err.message || 'Could not replace Model Answer.');
    }
  };

  const handleAddPapers = (exam: ManagedExam) => {
    router.push({
      pathname: '/session-setup',
      params: {
        parentExamId: exam.id,
        examName: exam.name,
        batchId: exam.batchId || '',
        batchName: exam.batchName || '',
        subjectId: exam.subjectId || '',
        subjectName: exam.subjectName || '',
        totalMarks: exam.totalMarks?.toString() || '',
        examDate: exam.examDate || '',
      }
    });
  };

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchOverview();
      fetchPerformanceInsights();
    } else if (activeTab === 'exams') {
      fetchExamManagement();
    } else if (activeTab === 'classroom') {
      fetchBatches();
    }
  }, [activeTab, fetchBatches, fetchExamManagement, fetchOverview, fetchPerformanceInsights]);

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
    }
  };

  const handleAddBatch = async () => {
    if (!newBatchName.trim()) {
      Alert.alert('Error', 'Please enter a batch name');
      return;
    }
    if (!token) return;
    try {
      await createManagedBatch({ backendUrl: getBackendUrl(), token }, { name: newBatchName.trim() });
      Alert.alert('Success', 'Batch created successfully!');
      setNewBatchName('');
      setShowAddBatchModal(false);
      fetchBatches();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const openEditBatch = (batch: Batch) => {
    setEditingBatch(batch);
    setEditBatchName(batch.name);
  };

  const handleUpdateBatch = async () => {
    if (!token || !editingBatch) return;
    const cleanName = editBatchName.trim();
    if (!cleanName) {
      Alert.alert('Name required', 'Enter a class name before saving.');
      return;
    }

    setIsSavingBatch(true);
    try {
      const updated = await updateManagedBatch({
        backendUrl: getBackendUrl(),
        token,
        batchId: editingBatch.batch_id,
      }, { name: cleanName });
      setBatches(prev => prev.map(batch => (
        batch.batch_id === updated.batch_id ? { ...batch, ...updated } : batch
      )));
      setEditingBatch(null);
      setEditBatchName('');
      await fetchBatches();
    } catch (err: any) {
      Alert.alert('Batch not saved', err.message || 'Could not update this batch.');
    } finally {
      setIsSavingBatch(false);
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
            if (!token) return;
            try {
              await deleteManagedBatch({ backendUrl: getBackendUrl(), token, batchId });
              Alert.alert('Success', 'Batch deleted successfully.');
              fetchBatches();
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
            if (!token) return;
            try {
              await archiveManagedBatch({ backendUrl: getBackendUrl(), token, batchId });
              Alert.alert('Success', 'Batch archived successfully.');
              fetchBatches();
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
    if (!token) return;
    try {
      await createBatchStudent(
        { backendUrl: getBackendUrl(), token, batchId: selectedBatchId },
        {
          name: newStudentName.trim(),
          rollNumber: newStudentRoll.trim(),
          email: newStudentEmail.trim() || undefined,
        }
      );
      Alert.alert('Success', 'Student added successfully!');
      setNewStudentName('');
      setNewStudentRoll('');
      setNewStudentEmail('');
      setShowAddStudentModal(false);
      fetchStudents(selectedBatchId);
      fetchBatches();
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
            if (!token) return;
            try {
              await deleteBatchStudent({ backendUrl: getBackendUrl(), token, batchId, studentId });
              Alert.alert('Success', 'Student removed successfully.');
              fetchStudents(batchId);
              fetchBatches();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          }
        }
      ]
    );
  };

  const handleExportRoster = async (batchId: string) => {
    if (!token) {
      Alert.alert('Authentication required', 'Please log in again.');
      return;
    }
    
    try {
      const downloadUrl = `${getBackendUrl()}/api/batches/${batchId}/students/export?token=${token}`;
      await Linking.openURL(downloadUrl);
    } catch (err: any) {
      Alert.alert('Export Failed', err.message || 'Could not download class roster template.');
    }
  };

  const handleImportRoster = async (batchId: string) => {
    if (!token) {
      Alert.alert('Authentication required', 'Please log in again.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      
      if (asset.name && !asset.name.toLowerCase().endsWith('.csv')) {
        Alert.alert('Invalid file format', 'Please select a valid CSV (.csv) file.');
        return;
      }

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: asset.name || 'roster.csv',
        type: 'text/csv',
      } as any);

      const response = await fetch(`${getBackendUrl()}/api/batches/${batchId}/students/import`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Import request failed.');
      }

      const data = await response.json();
      if (data.success) {
        let msg = `Roster synced successfully!\n\nAdded: ${data.added}\nUpdated: ${data.updated}\nLinked: ${data.linked}`;
        if (data.errors && data.errors.length > 0) {
          msg += `\n\nWarnings/Errors:\n${data.errors.slice(0, 3).join('\n')}`;
          if (data.errors.length > 3) {
            msg += `\n...and ${data.errors.length - 3} more errors.`;
          }
        }
        Alert.alert('Import Success', msg);
        
        fetchStudents(batchId);
        fetchBatches();
      } else {
        throw new Error(data.error || 'Failed to sync CSV data.');
      }
    } catch (err: any) {
      Alert.alert('Import Failed', err.message || 'Could not parse or sync uploaded CSV file.');
    }
  };

  const handleUpdateStudent = async (studentId: string, input: StudentProfileUpdateInput) => {
    if (!token) return;
    const batchId = selectedBatchId
      || Object.entries(studentsByBatch).find(([, students]) => students.some(student => student.student_id === studentId))?.[0];
    if (!batchId) {
      Alert.alert('Student not saved', 'Open the class roster again and retry.');
      return;
    }

    setSavingStudentId(studentId);
    try {
      const updated = await updateBatchStudent({
        backendUrl: getBackendUrl(),
        token,
        batchId,
        studentId,
      }, input);
      const mergedStudent = {
        ...selectedStudentReport,
        ...updated,
        student_id: updated.student_id || studentId,
        roll_number: updated.roll_number || input.rollNumber,
        rollNumber: updated.rollNumber || updated.roll_number || input.rollNumber,
        mobileNumber: updated.mobileNumber || updated.mobile_number || input.mobileNumber,
      } as Student;

      setStudentsByBatch(prev => ({
        ...prev,
        [batchId]: (prev[batchId] || []).map(student => (
          student.student_id === studentId ? { ...student, ...mergedStudent } : student
        )),
      }));
      setSelectedStudentReport(mergedStudent);
      await fetchStudents(batchId);
    } catch (err: any) {
      Alert.alert('Student not saved', err.message || 'Could not update student details.');
    } finally {
      setSavingStudentId(null);
    }
  };

  const toggleBatchExpand = (batchId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
    } else {
      setSelectedBatchId(batchId);
      setExpandedBatchId(batchId);
      fetchStudents(batchId);
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
                  : 'Publish, close, and review exams'}
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
              onRetry={fetchExamManagement}
              errorMessage={examLoadError}
              onAddPapers={handleAddPapers}
              onEditExam={handleEditExam}
              onExport={handleExportExam}
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

              {/* Classroom search input */}
              <View style={[styles.searchBarContainer, { marginTop: 0, marginBottom: 12 }]}>
                <View style={[styles.searchInputWrapper, { height: 40 }]}>
                  <Ionicons name="search-outline" size={18} color={COLORS.textMuted} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search classes or students..."
                    placeholderTextColor={COLORS.textMuted}
                    value={classroomSearchQuery}
                    onChangeText={setClassroomSearchQuery}
                  />
                  {classroomSearchQuery ? (
                    <TouchableOpacity onPress={() => setClassroomSearchQuery('')} style={styles.clearBtn}>
                      <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {loadingBatches ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 20 }} />
              ) : (() => {
                const q = classroomSearchQuery.toLowerCase().trim();
                const filteredBatches = batches.filter(batch => {
                  if (!q) return true;
                  if (batch.name.toLowerCase().includes(q)) return true;
                  const students = studentsByBatch[batch.batch_id] || [];
                  return students.some(std => 
                    (std.name && std.name.toLowerCase().includes(q)) ||
                    (std.roll_number && std.roll_number.toLowerCase().includes(q)) ||
                    (std.email && std.email.toLowerCase().includes(q))
                  );
                });

                if (batches.length === 0) {
                  return (
                    <View style={styles.emptyClassRoster}>
                      <Ionicons name="school-outline" size={40} color={COLORS.textMuted} />
                      <Text style={styles.noBatchesText}>No batches created yet.</Text>
                    </View>
                  );
                }

                if (filteredBatches.length === 0) {
                  return (
                    <View style={styles.emptyClassRoster}>
                      <Ionicons name="search-outline" size={40} color={COLORS.textMuted} />
                      <Text style={styles.noBatchesText}>No matching classes or students found.</Text>
                    </View>
                  );
                }

                return filteredBatches.map(batch => {
                  const students = studentsByBatch[batch.batch_id] || [];
                  const filteredStudents = students.filter(std => {
                    if (!q) return true;
                    return (
                      (std.name && std.name.toLowerCase().includes(q)) ||
                      (std.roll_number && std.roll_number.toLowerCase().includes(q)) ||
                      (std.email && std.email.toLowerCase().includes(q))
                    );
                  });

                  // Expand if searched and contains matching students, or if manually expanded
                  const isExpanded = expandedBatchId === batch.batch_id || (
                    q.length > 0 &&
                    students.some(std => 
                      (std.name && std.name.toLowerCase().includes(q)) ||
                      (std.roll_number && std.roll_number.toLowerCase().includes(q)) ||
                      (std.email && std.email.toLowerCase().includes(q))
                    )
                  );

                  const visibleStudentCount = studentsByBatch[batch.batch_id]
                    ? students.length
                    : batch.student_count || 0;

                  return (
                    <View key={batch.batch_id} style={styles.manageCard}>
                      <TouchableOpacity
                        style={styles.manageHeader}
                        onPress={() => toggleBatchExpand(batch.batch_id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.manageInfo}>
                          <Text style={styles.manageName}>{batch.name}</Text>
                          <Text style={styles.manageSubtitle}>
                            {classroomSearchQuery.trim() 
                              ? `${filteredStudents.length} matching of ${visibleStudentCount} students`
                              : `${visibleStudentCount} students`}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <TouchableOpacity
                            onPress={() => openEditBatch(batch)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                          </TouchableOpacity>
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
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                              <TouchableOpacity
                                style={styles.addStudentBtn}
                                onPress={() => handleExportRoster(batch.batch_id)}
                              >
                                <Ionicons name="download-outline" size={14} color={COLORS.primary} />
                                <Text style={styles.addStudentBtnText}>Export</Text>
                              </TouchableOpacity>
                              
                              <TouchableOpacity
                                style={styles.addStudentBtn}
                                onPress={() => handleImportRoster(batch.batch_id)}
                              >
                                <Ionicons name="upload-outline" size={14} color={COLORS.primary} />
                                <Text style={styles.addStudentBtnText}>Import</Text>
                              </TouchableOpacity>

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
                          </View>

                          {loadingStudents === batch.batch_id && (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 12 }} />
                          )}

                          {students.length === 0 && loadingStudents !== batch.batch_id && (
                            <Text style={styles.noStudentsText}>Roster is empty. Add your first student.</Text>
                          )}

                          {students.length > 0 && filteredStudents.length === 0 && (
                            <Text style={styles.noStudentsText}>No matching students in this class.</Text>
                          )}

                          {filteredStudents.map(std => (
                            <TouchableOpacity
                              key={std.student_id}
                              style={styles.studentItem}
                              onPress={() => {
                                setSelectedBatchId(batch.batch_id);
                                setSelectedStudentReport(std);
                              }}
                              activeOpacity={0.78}
                            >
                              <View style={styles.studentAvatar}>
                                <Text style={styles.studentAvatarText}>{std.name[0]?.toUpperCase()}</Text>
                              </View>
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.studentNameText}>{std.name}</Text>
                                <Text style={styles.studentPerformanceText}>
                                  Avg {formatStudentAverage(std.averagePercentage)}% - {std.examCount || 0} exams
                                </Text>
                                <Text style={styles.studentMetaText}>Roll No: {std.roll_number} {std.email ? `• ${std.email}` : ''}</Text>
                              </View>
                              <TouchableOpacity
                                style={styles.studentDetailButton}
                                onPress={() => {
                                  setSelectedBatchId(batch.batch_id);
                                  setSelectedStudentReport(std);
                                }}
                                activeOpacity={0.75}
                              >
                                <Text style={styles.studentDetailText}>Details</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => handleDeleteStudent(batch.batch_id, std.student_id, std.name)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                              </TouchableOpacity>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                });
              })()}
            </View>
          ) : null}

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

      {/* Edit Batch Modal */}
      <Modal visible={Boolean(editingBatch)} transparent animationType="slide" onRequestClose={() => setEditingBatch(null)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.sheetTitle}>Edit Class Batch</Text>
            <Text style={modalStyles.sheetSub}>Update the class name. Changes sync with the webapp.</Text>
            <TextInput
              style={modalStyles.input}
              value={editBatchName}
              onChangeText={setEditBatchName}
              placeholder="Class name"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleUpdateBatch}
            />
            <View style={modalStyles.buttons}>
              <TouchableOpacity
                style={[modalStyles.btn, modalStyles.cancelBtn]}
                onPress={() => setEditingBatch(null)}
                disabled={isSavingBatch}
              >
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.btn, modalStyles.saveBtn, isSavingBatch && { opacity: 0.7 }]}
                onPress={handleUpdateBatch}
                disabled={isSavingBatch}
              >
                {isSavingBatch ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={modalStyles.saveText}>Save</Text>
                )}
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

      <StudentReportModal
        visible={Boolean(selectedStudentReport)}
        student={selectedStudentReport}
        onClose={() => setSelectedStudentReport(null)}
        onSaveProfile={handleUpdateStudent}
        isSavingProfile={savingStudentId === selectedStudentReport?.student_id}
      />

      <ExportModal
        visible={showExportModal}
        onClose={() => setShowExportModal(false)}
        examId={exportExamId}
        examName={exportExamName}
        token={token}
      />

      {/* Edit Exam Details & Files Modal */}
      <Modal
        visible={Boolean(selectedEditExam)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedEditExam(null)}
      >
        <View style={modalStyles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%' }}
          >
            <View style={[modalStyles.sheet, { maxHeight: '90%' }]}>
              <View style={modalStyles.handle} />
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={modalStyles.sheetTitle}>Edit Exam Settings</Text>
                <TouchableOpacity onPress={() => setSelectedEditExam(null)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={24} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <Text style={modalStyles.sheetSub}>Modify exam metadata and files. Updates sync with the GradeSense server.</Text>

                {/* Exam Title */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={editModalStyles.label}>Exam Title</Text>
                  <TextInput
                    style={modalStyles.input}
                    value={editExamTitle}
                    onChangeText={setEditExamTitle}
                    placeholder="Exam Title"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                {/* Date and Marks */}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={editModalStyles.label}>Date (YYYY-MM-DD)</Text>
                    <TextInput
                      style={modalStyles.input}
                      value={editExamDate}
                      onChangeText={setEditExamDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={editModalStyles.label}>Total Marks</Text>
                    <TextInput
                      style={modalStyles.input}
                      value={editExamMarks}
                      onChangeText={setEditExamMarks}
                      placeholder="e.g. 100"
                      placeholderTextColor={COLORS.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                {/* File replacement section */}
                <Text style={[modalStyles.sheetTitle, { fontSize: 16, marginTop: 12, marginBottom: 8 }]}>Replace Exam Documents</Text>
                <Text style={[modalStyles.sheetSub, { fontSize: 12, marginBottom: 12 }]}>
                  Upload a new PDF to replace the current question paper or model answer.
                </Text>

                <View style={{ gap: 10, marginBottom: 20 }}>
                  {/* Replace QP Button */}
                  <TouchableOpacity
                    style={editModalStyles.fileRow}
                    onPress={handleReplaceQP}
                    disabled={isReplacingQP}
                    activeOpacity={0.8}
                  >
                    <View style={editModalStyles.fileIconBg}>
                      <Ionicons name="document-text" size={20} color="#1976D2" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={editModalStyles.fileLabel}>Question Paper PDF</Text>
                      <Text style={editModalStyles.fileSublabel}>Tap to upload a new Question Paper</Text>
                    </View>
                    {isReplacingQP ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Ionicons name="cloud-upload-outline" size={20} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>

                  {/* Replace MA Button */}
                  <TouchableOpacity
                    style={editModalStyles.fileRow}
                    onPress={handleReplaceMA}
                    disabled={isReplacingMA || isRegrading}
                    activeOpacity={0.8}
                  >
                    <View style={[editModalStyles.fileIconBg, { backgroundColor: '#E8F5E9' }]}>
                      <Ionicons name="clipboard" size={20} color="#388E3C" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={editModalStyles.fileLabel}>Model Answer PDF</Text>
                      <Text style={editModalStyles.fileSublabel}>Upload new answer key to regrade submissions</Text>
                    </View>
                    {isReplacingMA || isRegrading ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Ionicons name="cloud-upload-outline" size={20} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>

              {/* Action buttons */}
              <View style={modalStyles.buttons}>
                <TouchableOpacity
                  style={[modalStyles.btn, modalStyles.cancelBtn]}
                  onPress={() => setSelectedEditExam(null)}
                  disabled={isSavingExam}
                >
                  <Text style={modalStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[modalStyles.btn, modalStyles.saveBtn, isSavingExam && { opacity: 0.7 }]}
                  onPress={handleUpdateExamMetadata}
                  disabled={isSavingExam}
                >
                  {isSavingExam ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={modalStyles.saveText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function formatStudentAverage(value?: number | null): string {
  const average = Number(value || 0);
  return Number.isInteger(average) ? String(average) : average.toFixed(1);
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
  studentPerformanceText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  studentDetailButton: {
    backgroundColor: COLORS.primaryXLight,
    borderRadius: 999,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  studentDetailText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
    height: 44,
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

const editModalStyles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textLight,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    padding: 12,
    gap: 12,
  },
  fileIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  fileSublabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
