import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { Batch, ScanSessionSettings, Subject } from '../src/types';
import { useHardwareAwareBottomInset } from '../src/utils/safeArea';

export default function SessionSetupScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const insets = useSafeAreaInsets();
  const bottomContentInset = useHardwareAwareBottomInset(insets.bottom, 24);
  const { createSession, savedSessions, updateSessionDetails, savedBatches, createBatch, deleteBatch, fetchBatches, savedSubjects, fetchSubjects, createSubject } = useScanStore();
  
  useEffect(() => {
    fetchBatches().catch(err => console.error('Failed to load batches:', err));
    fetchSubjects().catch(err => console.error('Failed to load subjects:', err));
  }, [fetchBatches, fetchSubjects]);
  
  const [sessionName, setSessionName] = useState(
    `Scan — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  );
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [totalMarks, setTotalMarks] = useState('100');
  const [examDate, setExamDate] = useState(new Date().toISOString().split('T')[0]);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const isStartingSessionRef = useRef(false);
  
  // Create batch modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBatchName, setNewBatchName] = useState('');
  const [newBatchStudentCount, setNewBatchStudentCount] = useState('');
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectClass, setNewSubjectClass] = useState('');
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  
  // Scan options
  const [settings, setSettings] = useState<ScanSessionSettings>({
    scan_question_paper: false,
    scan_model_answer: true,
    auto_capture: true,
    auto_crop: false,
    barcode_detection: false,
    blur_detection: false,
    flash_mode: 'auto',
    page_mode: 'single', // default to single page
    grading_mode: 'balanced', // default to balanced
    pilot_review_first: false,
    feedback_enabled: true,
  });

  // Populate existing session details if in edit mode
  useEffect(() => {
    if (sessionId) {
      const existing = savedSessions.find(s => s.session_id === sessionId);
      if (existing) {
        setSessionName(existing.session_name);
        const batch = savedBatches.find(b => b.batch_id === existing.batch_id) || {
          batch_id: existing.batch_id,
          name: existing.batch_name,
          student_count: existing.stats.total_students,
        };
        setSelectedBatch(batch);
        
        const subject = savedSubjects.find(sub => sub.id === existing.subject_id);
        if (subject) {
          setSelectedSubject(subject);
        } else if (existing.subject_id) {
          setSelectedSubject({ id: existing.subject_id, name: 'Loaded Subject' });
        }
        
        setTotalMarks(existing.total_marks?.toString() || '100');
        setExamDate(existing.exam_date || new Date().toISOString().split('T')[0]);
        setSettings({
          ...existing.settings,
          auto_crop: false,
          grading_mode: existing.settings.grading_mode || 'balanced',
          pilot_review_first: Boolean(existing.settings.pilot_review_first || (existing.settings as any).pilotReviewFirst),
          feedback_enabled: existing.settings.feedback_enabled ?? (existing.settings as any).feedbackEnabled ?? true,
        });
      }
    }
  }, [sessionId, savedSessions, savedBatches, savedSubjects]);

  const totalMarksNumber = Number(totalMarks);
  const hasValidTotalMarks = Number.isFinite(totalMarksNumber) && totalMarksNumber > 0;
  const hasValidExamDate = /^\d{4}-\d{2}-\d{2}$/.test(examDate.trim()) && !Number.isNaN(Date.parse(`${examDate.trim()}T00:00:00`));
  const setupErrors = [
    !sessionName.trim() ? 'Enter an exam name.' : null,
    !selectedSubject ? 'Select or create a subject.' : null,
    !hasValidTotalMarks ? 'Enter total marks greater than 0.' : null,
    !hasValidExamDate ? 'Enter a valid exam date in YYYY-MM-DD format.' : null,
    !selectedBatch ? 'Select or create a batch.' : null,
    !settings.scan_model_answer ? 'Model Answer is required before scanning or uploading.' : null,
  ].filter(Boolean) as string[];
  const canStartScanning = setupErrors.length === 0 && !isCreatingBatch && !isCreatingSubject && !isStartingSession;

  const handleCreateBatch = async () => {
    if (!newBatchName.trim()) {
      Alert.alert('Batch name required', 'Enter a batch name before creating it.');
      return;
    }
    
    const studentCount = parseInt(newBatchStudentCount) || 0;

    setIsCreatingBatch(true);
    try {
      const newBatch = await createBatch(newBatchName, studentCount);
      setSelectedBatch({
        ...newBatch,
        student_count: studentCount || newBatch.student_count,
      });
      setShowCreateModal(false);
      setNewBatchName('');
      setNewBatchStudentCount('');
    } catch (err: any) {
      Alert.alert('Batch not created', err.message || 'Could not sync this batch with the webapp.');
    } finally {
      setIsCreatingBatch(false);
    }
  };

  const handleDeleteBatch = (batchId: string) => {
    deleteBatch(batchId);
    if (selectedBatch?.batch_id === batchId) {
      setSelectedBatch(null);
    }
  };

  const handleCreateSubject = async () => {
    if (!newSubjectName.trim()) return;

    setIsCreatingSubject(true);
    try {
      const subject = await createSubject(newSubjectName, newSubjectClass);
      setSelectedSubject(subject);
      setShowSubjectModal(false);
      setNewSubjectName('');
      setNewSubjectClass('');
    } catch (err: any) {
      Alert.alert('Subject not created', err.message || 'Could not create this subject.');
    } finally {
      setIsCreatingSubject(false);
    }
  };

  const handleStartScanning = async (destination: 'scanner' | 'upload' = 'scanner') => {
    if (!canStartScanning) {
      Alert.alert('Complete setup first', setupErrors.join('\n'));
      return;
    }

    if (isStartingSessionRef.current) return;
    
    isStartingSessionRef.current = true;
    setIsStartingSession(true);
    try {
      const cleanSessionName = sessionName.trim();
      const cleanExamDate = examDate.trim();
      if (sessionId) {
        // Edit Mode: Update details on existing session
        updateSessionDetails(
          sessionId,
          cleanSessionName,
          selectedBatch!.batch_id,
          selectedBatch!.name,
          selectedSubject!.id,
          totalMarksNumber,
          cleanExamDate,
          settings
        );
        router.back();
      } else {
        // Create Mode
        const createdSession = await createSession(
          cleanSessionName,
          selectedBatch!.batch_id,
          selectedBatch!.name,
          settings,
          selectedSubject!.id,
          totalMarksNumber,
          cleanExamDate
        );
        if (destination === 'upload') {
          router.replace({ pathname: '/upload', params: { sessionId: createdSession.session_id, documentMode: '1' } });
        } else {
          router.replace('/scanner');
        }
      }
    } catch (err: any) {
      console.error(err);
      Alert.alert('Could not start scanning', err.message || 'Please check your setup and try again.');
    } finally {
      isStartingSessionRef.current = false;
      setIsStartingSession(false);
    }
  };

  const updateSetting = (key: keyof ScanSessionSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{sessionId ? 'Edit Session' : 'New Session'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={{ paddingBottom: bottomContentInset + 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Session Name */}
          <View style={styles.section}>
            <Text style={styles.label}>Session Name</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={sessionName}
                onChangeText={setSessionName}
                placeholder="Enter session name"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>

          {/* Subject Selection */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.label}>Select Subject</Text>
              <TouchableOpacity
                style={styles.createBatchBtn}
                onPress={() => setShowSubjectModal(true)}
              >
                <Ionicons name="add-circle" size={20} color={COLORS.primary} />
                <Text style={styles.createBatchText}>New Subject</Text>
              </TouchableOpacity>
            </View>
            {savedSubjects.length === 0 ? (
              <View style={styles.emptySubjectBox}>
                <Text style={styles.emptyTextSub}>No subjects available yet.</Text>
                <TouchableOpacity style={styles.inlineCreateBtn} onPress={() => setShowSubjectModal(true)}>
                  <Text style={styles.inlineCreateText}>Add subject</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subjectScroll}>
                {savedSubjects.map(subject => {
                  const isSelected = selectedSubject?.id === subject.id;
                  return (
                    <TouchableOpacity
                      key={subject.id}
                      style={[
                        styles.subjectPill,
                        isSelected && styles.subjectPillSelected
                      ]}
                      onPress={() => setSelectedSubject(subject)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="book"
                        size={16}
                        color={isSelected ? '#fff' : COLORS.textMuted}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={[
                        styles.subjectText,
                        isSelected && styles.subjectTextSelected
                      ]}>{subject.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Total Marks & Date Row */}
          <View style={styles.row}>
            <View style={[styles.section, { flex: 1, marginRight: 8 }]}>
              <Text style={styles.label}>Total Marks</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  value={totalMarks}
                  onChangeText={setTotalMarks}
                  placeholder="100"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={[styles.section, { flex: 1, marginLeft: 8 }]}>
              <Text style={styles.label}>Exam Date</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  value={examDate}
                  onChangeText={setExamDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>
          </View>

          {/* Batch Selection */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.label}>Select or Create Batch</Text>
              <TouchableOpacity 
                style={styles.createBatchBtn}
                onPress={() => setShowCreateModal(true)}
              >
                <Ionicons name="add-circle" size={20} color={COLORS.primary} />
                <Text style={styles.createBatchText}>New Batch</Text>
              </TouchableOpacity>
            </View>
            
            {savedBatches.length === 0 ? (
              <View style={styles.emptyBatches}>
                <Ionicons name="folder-open-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>No batches yet</Text>
                <Text style={styles.emptySubtext}>Create a new batch to get started</Text>
                <TouchableOpacity 
                  style={styles.createFirstBatch}
                  onPress={() => setShowCreateModal(true)}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.createFirstBatchText}>Create First Batch</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.batchList}>
                {savedBatches.map(batch => (
                  <TouchableOpacity
                    key={batch.batch_id}
                    style={[
                      styles.batchItem,
                      selectedBatch?.batch_id === batch.batch_id && styles.batchItemSelected,
                    ]}
                    onPress={() => setSelectedBatch(batch)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.batchInfo}>
                      <View style={[
                        styles.batchRadio,
                        selectedBatch?.batch_id === batch.batch_id && styles.batchRadioSelected,
                      ]}>
                        {selectedBatch?.batch_id === batch.batch_id && (
                          <Ionicons name="checkmark" size={14} color="#fff" />
                        )}
                      </View>
                      <View>
                        <Text style={styles.batchName}>{batch.name}</Text>
                        <Text style={styles.batchStudents}>
                          {batch.student_count > 0 ? `${batch.student_count} students` : 'Students: TBD'}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity 
                      onPress={() => handleDeleteBatch(batch.batch_id)}
                      style={styles.deleteBatchBtn}
                    >
                      <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Grading Mode / Correction Type Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>GRADING MODE</Text>
            <View style={styles.gradingGrid}>
              {[
                { key: 'strict', title: 'Strict', icon: 'shield-half-outline', desc: 'Exact rubric matching', color: '#E53935' },
                { key: 'balanced', title: 'Balanced', icon: 'scale-outline', desc: 'Standard balance (recommended)', color: COLORS.primary },
                { key: 'conceptual', title: 'Conceptual', icon: 'bulb-outline', desc: 'Focuses on keyword & concepts', color: '#5E35B1' },
                { key: 'lenient', title: 'Lenient', icon: 'heart-outline', desc: 'Generous scoring criteria', color: '#43A047' }
              ].map((mode) => {
                const isSelected = settings.grading_mode === mode.key;
                return (
                  <TouchableOpacity
                    key={mode.key}
                    style={[
                      styles.gradingOptionCard,
                      isSelected && [
                        styles.gradingOptionCardSelected,
                        { borderColor: mode.color, backgroundColor: '#fff' },
                      ]
                    ]}
                    onPress={() => updateSetting('grading_mode', mode.key)}
                    activeOpacity={0.8}
                  >
                    <View style={[
                      styles.gradingIconContainer,
                      { backgroundColor: isSelected ? mode.color : '#F5F5F5' },
                      isSelected && styles.gradingIconContainerSelected,
                    ]}>
                      <Ionicons name={mode.icon as any} size={20} color={isSelected ? '#fff' : '#666'} />
                    </View>
                    <View style={styles.gradingTextContainer}>
                      <Text style={[styles.gradingTitle, isSelected && { color: mode.color, fontWeight: '700' }]}>{mode.title}</Text>
                      <Text style={styles.gradingDesc}>{mode.desc}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI REVIEW LOOP</Text>
            <View style={styles.optionCard}>
              <View style={styles.optionRow}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: COLORS.primaryXLight }]}>
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Generate detailed student feedback</Text>
                    <Text style={styles.optionHint}>Turn this off when teachers only need marks from AI</Text>
                  </View>
                </View>
                <Switch
                  value={settings.feedback_enabled !== false}
                  onValueChange={(value) => updateSetting('feedback_enabled', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.feedback_enabled !== false ? COLORS.primary : '#f4f3f4'}
                />
              </View>
              <View style={[styles.optionRow, { borderBottomWidth: 0 }]}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#FFF3E0' }]}>
                    <Ionicons name="school-outline" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Review First Paper First</Text>
                    <Text style={styles.optionHint}>Grade one paper, review corrections, then apply them to the rest</Text>
                  </View>
                </View>
                <Switch
                  value={Boolean(settings.pilot_review_first)}
                  onValueChange={(value) => updateSetting('pilot_review_first', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.pilot_review_first ? COLORS.primary : '#f4f3f4'}
                />
              </View>
            </View>
          </View>

          {/* Scan Options */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PAGE MODE</Text>
            
            {/* Page Mode Selector */}
            <View style={styles.pageModeContainer}>
              <TouchableOpacity
                style={[
                  styles.pageModeOption,
                  settings.page_mode === 'single' && styles.pageModeOptionSelected,
                ]}
                onPress={() => updateSetting('page_mode', 'single')}
              >
                <View style={styles.pageModeIcon}>
                  <Ionicons 
                    name="document" 
                    size={32} 
                    color={settings.page_mode === 'single' ? COLORS.primary : COLORS.textMuted} 
                  />
                </View>
                <Text style={[
                  styles.pageModeTitle,
                  settings.page_mode === 'single' && styles.pageModeTitleSelected,
                ]}>Single Page</Text>
                <Text style={styles.pageModeDesc}>1 capture = 1 page</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.pageModeOption,
                  settings.page_mode === 'double' && styles.pageModeOptionSelected,
                ]}
                onPress={() => updateSetting('page_mode', 'double')}
              >
                <View style={styles.pageModeIcon}>
                  <Ionicons 
                    name="documents" 
                    size={32} 
                    color={settings.page_mode === 'double' ? COLORS.primary : COLORS.textMuted} 
                  />
                </View>
                <Text style={[
                  styles.pageModeTitle,
                  settings.page_mode === 'double' && styles.pageModeTitleSelected,
                ]}>Double Page</Text>
                <Text style={styles.pageModeDesc}>1 capture = 2 pages</Text>
              </TouchableOpacity>
            </View>
            
            {settings.page_mode === 'double' && (
              <View style={styles.doubleModeInfo}>
                <Ionicons name="information-circle" size={18} color={COLORS.primary} />
                <Text style={styles.doubleModeInfoText}>
                  Image will be split into left and right pages automatically
                </Text>
              </View>
            )}
          </View>

          {/* Other Scan Options */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SCAN OPTIONS</Text>
            
            <View style={styles.optionCard}>
              <View style={styles.optionRow}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#E3F2FD' }]}>
                    <Ionicons name="document-text" size={20} color="#1976D2" />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Scan Question Paper</Text>
                    <Text style={styles.optionHint}>Scan QP pages before student papers</Text>
                  </View>
                </View>
                <Switch
                  value={settings.scan_question_paper}
                  onValueChange={(value) => updateSetting('scan_question_paper', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.scan_question_paper ? COLORS.primary : '#f4f3f4'}
                />
              </View>

              <View style={styles.optionRow}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#E8F5E9' }]}>
                    <Ionicons name="clipboard" size={20} color="#388E3C" />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Scan Model Answer *</Text>
                    <Text style={styles.optionHint}>Required for grading before student papers</Text>
                  </View>
                </View>
                <Switch
                  value={settings.scan_model_answer}
                  onValueChange={(value) => updateSetting('scan_model_answer', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.scan_model_answer ? COLORS.primary : '#f4f3f4'}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.optionRow}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#FFF3E0' }]}>
                    <Ionicons name="flash" size={20} color="#F57C00" />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Auto-Capture Mode</Text>
                    <Text style={styles.optionHint}>Automatically capture when stable</Text>
                  </View>
                </View>
                <Switch
                  value={settings.auto_capture}
                  onValueChange={(value) => updateSetting('auto_capture', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.auto_capture ? COLORS.primary : '#f4f3f4'}
                />
              </View>

              <View style={styles.optionRow}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#E0F7FA' }]}>
                    <Ionicons name="crop" size={20} color="#00838F" />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Auto-Crop Mode</Text>
                    <Text style={styles.optionHint}>Automatically detect and crop document</Text>
                  </View>
                </View>
                <Switch
                  value={settings.auto_crop === true}
                  onValueChange={(value) => updateSetting('auto_crop', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.auto_crop === true ? COLORS.primary : '#f4f3f4'}
                />
              </View>

              <View style={styles.optionRow}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#F3E5F5' }]}>
                    <Ionicons name="barcode" size={20} color="#7B1FA2" />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Barcode Detection</Text>
                    <Text style={styles.optionHint}>Detect QR/barcode on first page</Text>
                  </View>
                </View>
                <Switch
                  value={settings.barcode_detection}
                  onValueChange={(value) => updateSetting('barcode_detection', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.barcode_detection ? COLORS.primary : '#f4f3f4'}
                />
              </View>

              <View style={[styles.optionRow, { borderBottomWidth: 0 }]}>
                <View style={styles.optionLeft}>
                  <View style={[styles.optionIcon, { backgroundColor: '#FFEBEE' }]}>
                    <Ionicons name="eye" size={20} color="#D32F2F" />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text style={styles.optionLabel}>Blur Detection</Text>
                    <Text style={styles.optionHint}>Warn if captured image is blurry</Text>
                  </View>
                </View>
                <Switch
                  value={settings.blur_detection}
                  onValueChange={(value) => updateSetting('blur_detection', value)}
                  trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                  thumbColor={settings.blur_detection ? COLORS.primary : '#f4f3f4'}
                />
              </View>
            </View>
          </View>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={COLORS.primary} />
            <Text style={styles.infoText}>
              {settings.scan_question_paper || settings.scan_model_answer
                ? `Flow: ${settings.scan_question_paper ? 'Question Paper -> ' : ''}${settings.scan_model_answer ? 'Model Answer -> ' : ''}Student Papers${settings.pilot_review_first ? ' with first-paper review' : ''}`
                : settings.pilot_review_first
                  ? 'Student papers will start with a first-paper review before bulk grading continues'
                  : 'You will directly start scanning student answer papers'
              }
            </Text>
          </View>

          {setupErrors.length > 0 && (
            <View style={styles.validationBox}>
              {setupErrors.map(error => (
                <Text key={error} style={styles.validationText}>- {error}</Text>
              ))}
            </View>
          )}

          {sessionId ? (
            <TouchableOpacity
              style={[
                styles.startButton,
                !canStartScanning && styles.startButtonDisabled,
              ]}
              onPress={() => handleStartScanning('scanner')}
              disabled={!canStartScanning}
              activeOpacity={0.8}
            >
              {isStartingSession ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="save" size={24} color="#fff" />
              )}
              <Text style={styles.startButtonText}>SAVE CHANGES</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.secondaryActionButton,
                  !canStartScanning && styles.secondaryActionButtonDisabled,
                ]}
                onPress={() => handleStartScanning('upload')}
                disabled={!canStartScanning}
                activeOpacity={0.85}
              >
                {isStartingSession ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={22} color={COLORS.primary} />
                )}
                <Text style={styles.secondaryActionText}>UPLOAD</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.startButton,
                  styles.actionRowPrimary,
                  !canStartScanning && styles.startButtonDisabled,
                ]}
                onPress={() => handleStartScanning('scanner')}
                disabled={!canStartScanning}
                activeOpacity={0.85}
              >
                {isStartingSession ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name="camera" size={22} color="#fff" />
                )}
                <Text style={styles.startButtonText}>SCAN</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 8 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Create Batch Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Batch</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} disabled={isCreatingBatch}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Batch Name *</Text>
              <TextInput
                style={styles.modalInput}
                value={newBatchName}
                onChangeText={setNewBatchName}
                placeholder="e.g., UPSC 2025 Batch A"
                placeholderTextColor={COLORS.textMuted}
                autoFocus
              />

              <Text style={styles.modalLabel}>Number of Students (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={newBatchStudentCount}
                onChangeText={setNewBatchStudentCount}
                placeholder="e.g., 30"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
              />
              <Text style={styles.modalHint}>
                Leave empty if you don{"'"}t know yet. Students will be auto-created as you scan.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateModal(false)}
                disabled={isCreatingBatch}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalCreateBtn,
                  (!newBatchName.trim() || isCreatingBatch) && styles.modalCreateBtnDisabled,
                ]}
                onPress={handleCreateBatch}
                disabled={!newBatchName.trim() || isCreatingBatch}
              >
                <Text style={styles.modalCreateText}>{isCreatingBatch ? 'Creating...' : 'Create Batch'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSubjectModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSubjectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Subject</Text>
              <TouchableOpacity onPress={() => setShowSubjectModal(false)} disabled={isCreatingSubject}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Subject Name *</Text>
              <TextInput
                style={styles.modalInput}
                value={newSubjectName}
                onChangeText={setNewSubjectName}
                placeholder="e.g., Accounts"
                placeholderTextColor={COLORS.textMuted}
                autoFocus
              />

              <Text style={styles.modalLabel}>Class / Standard (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={newSubjectClass}
                onChangeText={setNewSubjectClass}
                placeholder="e.g., Class 10-A"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowSubjectModal(false)}
                disabled={isCreatingSubject}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalCreateBtn,
                  (!newSubjectName.trim() || isCreatingSubject) && styles.modalCreateBtnDisabled,
                ]}
                onPress={handleCreateSubject}
                disabled={!newSubjectName.trim() || isCreatingSubject}
              >
                <Text style={styles.modalCreateText}>{isCreatingSubject ? 'Saving...' : 'Add Subject'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  inputContainer: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },
  createBatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  createBatchText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyBatches: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  emptySubjectBox: {
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  inlineCreateBtn: {
    backgroundColor: COLORS.primaryXLight,
    borderColor: `${COLORS.primary}30`,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  inlineCreateText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  createFirstBatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  createFirstBatchText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  batchList: {
    marginTop: 8,
    gap: 8,
  },
  batchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: 8,
  },
  batchItemSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}08`,
  },
  batchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  batchRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  batchRadioSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  batchName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  batchStudents: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  deleteBatchBtn: {
    padding: 8,
  },
  // Page Mode Styles
  pageModeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  pageModeOption: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pageModeOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}08`,
  },
  pageModeIcon: {
    marginBottom: 8,
  },
  pageModeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  pageModeTitleSelected: {
    color: COLORS.primary,
  },
  pageModeDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  doubleModeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${COLORS.primary}10`,
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  doubleModeInfoText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.text,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
  },
  optionCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionTextContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  optionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  divider: {
    height: 8,
    backgroundColor: COLORS.backgroundDark,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: `${COLORS.primary}10`,
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 20,
  },
  validationBox: {
    backgroundColor: COLORS.errorLight,
    borderColor: `${COLORS.error}30`,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  validationText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 16,
  },
  startButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionRowPrimary: {
    flex: 1,
  },
  secondaryActionButton: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: COLORS.primary,
    borderRadius: 16,
    borderWidth: 2,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  secondaryActionButtonDisabled: {
    borderColor: COLORS.border,
    opacity: 0.6,
  },
  secondaryActionText: {
    color: COLORS.primary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalBody: {
    padding: 20,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  modalHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  modalCreateBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  modalCreateBtnDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  modalCreateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  subjectScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  subjectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  subjectPillSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  subjectText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '500',
  },
  subjectTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyTextSub: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  gradingGrid: {
    gap: 10,
    marginBottom: 8,
  },
  gradingOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  gradingOptionCardSelected: {
    shadowColor: COLORS.primary,
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  gradingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  gradingIconContainerSelected: {
    shadowColor: COLORS.primary,
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  gradingTextContainer: {
    flex: 1,
  },
  gradingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  gradingDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
