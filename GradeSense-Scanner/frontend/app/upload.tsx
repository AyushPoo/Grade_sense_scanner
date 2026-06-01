import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Modal,
  FlatList,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, WEBAPP_URL } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { useShallow } from 'zustand/react/shallow';
import { ScanSession } from '../src/types';
import { uploadSessionToWebApp } from '../src/api/export';

// Simple Progress Bar Component
const ProgressBar = ({ progress }: { progress: number }) => (
  <View style={progressStyles.container}>
    <View style={[progressStyles.fill, { width: `${progress * 100}%` }]} />
  </View>
);

const progressStyles = StyleSheet.create({
  container: {
    width: '100%',
    height: 12,
    backgroundColor: COLORS.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
  },
});

export default function UploadScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  // ── DEV INSTRUMENTATION (Phase 1) ──────────────────────────────────────────
  const renderCountRef = useRef(0);
  renderCountRef.current++;
  if (__DEV__) {
    console.log(`[RENDER] UploadScreen: count=${renderCountRef.current}`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // ── PHASE 1 FIX: Granular selectors — UploadScreen is now isolated from broad store changes.
  const updateSessionStatus = useScanStore(state => state.updateSessionStatus);
  const updateSessionDetails = useScanStore(state => state.updateSessionDetails);
  const { savedSubjects, fetchSubjects, createSubject } = useScanStore();
  const sessionDataFromStore = useScanStore(useShallow(state => 
    state.savedSessions.find(s => s.session_id === sessionId) || null
  ));
  
  const [session, setSession] = useState<ScanSession | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentItem, setCurrentItem] = useState('');
  const [uploadComplete, setUploadComplete] = useState(false);
  const [showSubjectSelector, setShowSubjectSelector] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectClass, setNewSubjectClass] = useState('');
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);

  useEffect(() => {
    fetchSubjects().catch(err => console.error('Failed to load subjects:', err));
  }, [fetchSubjects]);

  useEffect(() => {
    if (sessionId) {
      const found = sessionDataFromStore;
      if (found) {
        setSession(found);
        if (found.status === 'uploaded') {
          setUploadComplete(true);
          setProgress(1);
        }
      }
    }
  }, [sessionId, sessionDataFromStore]);

  const simulateUpload = async () => {
    if (!session) return;
    
    setIsUploading(true);

    try {
      await uploadSessionToWebApp(session, (item, prog) => {
        setCurrentItem(item);
        setProgress(prog);
      });

      // Complete
      setProgress(1);
      setUploadComplete(true);
    } catch (error: any) {
      console.error('Upload error:', error);
      const errMsg = error?.message || 'Unknown network or server error';
      Alert.alert('Upload Failed', `Failed to upload session: ${errMsg}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectSubject = (subjectId: string) => {
    setShowSubjectSelector(false);
    if (!session) return;

    // Update subject details in store
    updateSessionDetails(
      session.session_id,
      session.session_name,
      session.batch_id,
      session.batch_name,
      subjectId,
      session.total_marks,
      session.exam_date,
      session.settings
    );

    // Give state a brief moment to update before launching sync
    setTimeout(() => {
      simulateUpload();
    }, 150);
  };

  const handleCreateSubject = async () => {
    if (!newSubjectName.trim()) return;

    setIsCreatingSubject(true);
    try {
      const subject = await createSubject(newSubjectName, newSubjectClass);
      setNewSubjectName('');
      setNewSubjectClass('');
      handleSelectSubject(subject.id);
    } catch (error: any) {
      Alert.alert('Subject not created', error?.message || 'Could not create this subject.');
    } finally {
      setIsCreatingSubject(false);
    }
  };

  const handleStartUpload = () => {
    if (!session) return;

    if (!session.subject_id) {
      setShowSubjectSelector(true);
      return;
    }

    Alert.alert(
      'Start Upload',
      'This will upload all scanned pages to GradeSense. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upload', onPress: simulateUpload },
      ]
    );
  };

  const handleCancel = () => {
    if (isUploading) {
      Alert.alert(
        'Cancel Upload',
        'Are you sure you want to cancel the upload?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Cancel',
            style: 'destructive',
            onPress: () => {
              setIsUploading(false);
              updateSessionStatus(session!.session_id, 'ready', 0);
            },
          },
        ]
      );
    } else {
      router.back();
    }
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Upload</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContent}>
          <Text style={styles.emptyText}>Session not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel} style={styles.backButton}>
          <Ionicons name="close" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {uploadComplete ? 'Upload Complete' : isUploading ? 'Uploading...' : 'Upload'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        {uploadComplete ? (
          // Upload Complete View
          <View style={styles.completeContainer}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
            </View>
            <Text style={styles.completeTitle}>Upload Complete!</Text>
            <Text style={styles.completeSubtitle}>
              All {session.stats.total_pages} pages uploaded successfully
            </Text>

            <View style={[styles.nextSteps, { backgroundColor: '#F0F9FF', borderColor: '#BEE3F8', borderWidth: 1 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="sparkles" size={18} color={COLORS.primary} />
                <Text style={[styles.nextStepsTitle, { color: COLORS.primary, marginBottom: 0 }]}>AI Grading Started</Text>
              </View>
              <Text style={styles.nextStepsItem}>• Submissions are being graded by AI in the background.</Text>
              <Text style={styles.nextStepsItem}>• A live progress card will appear on your Home tab.</Text>
              <Text style={styles.nextStepsItem}>• When done, tap the card to review student marks on your phone.</Text>
            </View>

            <TouchableOpacity
              style={styles.openWebappButton}
              onPress={() => router.replace('/(tabs)/home')}
            >
              <Ionicons name="home" size={20} color="#fff" />
              <Text style={styles.openWebappText}>Back to Home & Track Progress</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.homeButton, { borderColor: COLORS.border, borderWidth: 1, marginTop: 8 }]}
              onPress={() => Linking.openURL(WEBAPP_URL)}
            >
              <Ionicons name="globe-outline" size={20} color={COLORS.textLight} style={{ marginRight: 8 }} />
              <Text style={[styles.homeButtonText, { color: COLORS.textLight }]}>Open GradeSense Webapp</Text>
            </TouchableOpacity>
          </View>
        ) : isUploading ? (
          // Uploading View
          <View style={styles.uploadingContainer}>
            <Text style={styles.uploadingTitle}>UPLOADING...</Text>
            
            <View style={styles.progressContainer}>
              <ProgressBar progress={progress} />
              <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
            </View>

            <Text style={styles.currentItemText}>{currentItem}</Text>

            <View style={styles.uploadStats}>
              <View style={styles.uploadStatItem}>
                <Ionicons name="document" size={20} color={COLORS.textMuted} />
                <Text style={styles.uploadStatText}>
                  Pages: {Math.round(progress * session.stats.total_pages)} / {session.stats.total_pages}
                </Text>
              </View>
            </View>

            <View style={styles.uploadItemsList}>
              <View style={styles.uploadItem}>
                <Ionicons
                  name={progress >= 0.1 ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={progress >= 0.1 ? COLORS.success : COLORS.textMuted}
                />
                <Text style={styles.uploadItemText}>Question Paper</Text>
              </View>
              <View style={styles.uploadItem}>
                <Ionicons
                  name={progress >= 0.2 ? 'checkmark-circle' : progress > 0.1 ? 'sync' : 'ellipse-outline'}
                  size={20}
                  color={progress >= 0.2 ? COLORS.success : progress > 0.1 ? COLORS.primary : COLORS.textMuted}
                />
                <Text style={styles.uploadItemText}>Model Answer</Text>
              </View>
              <View style={styles.uploadItem}>
                <Ionicons
                  name={progress >= 1 ? 'checkmark-circle' : progress > 0.2 ? 'sync' : 'ellipse-outline'}
                  size={20}
                  color={progress >= 1 ? COLORS.success : progress > 0.2 ? COLORS.primary : COLORS.textMuted}
                />
                <Text style={styles.uploadItemText}>Student Papers</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Pre-upload View
          <View style={styles.preUploadContainer}>
            <View style={styles.sessionSummary}>
              <Text style={styles.sessionName}>{session.session_name}</Text>
              <Text style={styles.sessionBatch}>{session.batch_name}</Text>
              <TouchableOpacity
                style={styles.editDetailsButton}
                onPress={() => router.push({ pathname: '/session-setup', params: { sessionId: session.session_id } })}
                activeOpacity={0.7}
              >
                <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                <Text style={styles.editDetailsText}>Edit Exam Details</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.uploadPreview}>
              <View style={styles.previewItem}>
                <Ionicons name="document-text" size={24} color={COLORS.primary} />
                <View style={styles.previewItemInfo}>
                  <Text style={styles.previewItemLabel}>Question Paper</Text>
                  <Text style={styles.previewItemValue}>{session.question_paper.page_count} pages</Text>
                </View>
              </View>

              <View style={styles.previewItem}>
                <Ionicons name="clipboard" size={24} color={COLORS.primary} />
                <View style={styles.previewItemInfo}>
                  <Text style={styles.previewItemLabel}>Model Answer</Text>
                  <Text style={styles.previewItemValue}>{session.model_answer.page_count} pages</Text>
                </View>
              </View>

              <View style={styles.previewItem}>
                <Ionicons name="people" size={24} color={COLORS.primary} />
                <View style={styles.previewItemInfo}>
                  <Text style={styles.previewItemLabel}>Students</Text>
                  <Text style={styles.previewItemValue}>
                    {session.stats.total_students} students, {session.stats.total_pages - session.question_paper.page_count - session.model_answer.page_count} pages
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.startUploadButton} onPress={handleStartUpload}>
              <Ionicons name="cloud-upload" size={24} color="#fff" />
              <Text style={styles.startUploadText}>START UPLOAD</Text>
            </TouchableOpacity>

            <Text style={styles.disclaimer}>
              Upload will continue in background. You can close the app.
            </Text>
          </View>
        )}
      </View>

      <Modal
        visible={showSubjectSelector}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSubjectSelector(false)}
      >
        <View style={modalStyles.overlay}>
          <View style={modalStyles.content}>
            <View style={modalStyles.header}>
              <Text style={modalStyles.title}>Select Subject</Text>
              <TouchableOpacity onPress={() => setShowSubjectSelector(false)} style={modalStyles.closeBtn}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={modalStyles.body}>
              <Text style={modalStyles.subtitle}>Please select a subject for this session before uploading:</Text>
              {savedSubjects.length > 0 ? (
                <FlatList
                  data={savedSubjects}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={modalStyles.subjectItem}
                      onPress={() => handleSelectSubject(item.id)}
                    >
                      <Ionicons name="book-outline" size={20} color={COLORS.primary} style={{ marginRight: 12 }} />
                      <Text style={modalStyles.subjectName}>{item.name}</Text>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} style={{ marginLeft: 'auto' }} />
                    </TouchableOpacity>
                  )}
                  style={{ maxHeight: 300 }}
                  contentContainerStyle={{ paddingBottom: 16 }}
                />
              ) : (
                <Text style={modalStyles.emptyText}>No subjects available yet. Add one below to continue.</Text>
              )}

              <View style={modalStyles.createCard}>
                <View style={modalStyles.createHeader}>
                  <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                  <Text style={modalStyles.createTitle}>Add New Subject</Text>
                </View>
                <TextInput
                  style={modalStyles.input}
                  value={newSubjectName}
                  onChangeText={setNewSubjectName}
                  placeholder="Subject name"
                  placeholderTextColor={COLORS.textMuted}
                />
                <TextInput
                  style={modalStyles.input}
                  value={newSubjectClass}
                  onChangeText={setNewSubjectClass}
                  placeholder="Class or standard (optional)"
                  placeholderTextColor={COLORS.textMuted}
                />
                <TouchableOpacity
                  style={[
                    modalStyles.createButton,
                    (!newSubjectName.trim() || isCreatingSubject) && modalStyles.createButtonDisabled,
                  ]}
                  onPress={handleCreateSubject}
                  disabled={!newSubjectName.trim() || isCreatingSubject}
                  activeOpacity={0.8}
                >
                  {isCreatingSubject ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={modalStyles.createButtonText}>Add & Continue</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
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
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    padding: 24,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  preUploadContainer: {
    flex: 1,
  },
  sessionSummary: {
    alignItems: 'center',
    marginBottom: 32,
  },
  sessionName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  sessionBatch: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  uploadPreview: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 16,
    marginBottom: 32,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  previewItemInfo: {
    marginLeft: 16,
    flex: 1,
  },
  previewItemLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  previewItemValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 2,
  },
  startUploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 16,
  },
  startUploadText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
  uploadingContainer: {
    flex: 1,
    alignItems: 'center',
  },
  uploadingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 2,
    marginBottom: 32,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 8,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'right',
    marginTop: 8,
  },
  currentItemText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 24,
  },
  uploadStats: {
    width: '100%',
    marginBottom: 24,
  },
  uploadStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uploadStatText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  uploadItemsList: {
    width: '100%',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  uploadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  uploadItemText: {
    fontSize: 15,
    color: COLORS.text,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelButtonText: {
    fontSize: 16,
    color: COLORS.error,
    fontWeight: '600',
  },
  completeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    marginBottom: 24,
  },
  completeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 8,
  },
  completeSubtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
  },
  nextSteps: {
    width: '100%',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  nextStepsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  nextStepsItem: {
    fontSize: 14,
    color: COLORS.textLight,
    paddingVertical: 4,
  },
  openWebappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    marginBottom: 16,
  },
  openWebappText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  homeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  homeButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  editDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark || 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 10,
    gap: 4,
  },
  editDetailsText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 20,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  subjectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark || '#F5F5F5',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  subjectName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  createCard: {
    backgroundColor: COLORS.cardBg,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    padding: 14,
  },
  createHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  createTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    backgroundColor: COLORS.backgroundDark || '#F5F5F5',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 15,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 13,
  },
  createButtonDisabled: {
    opacity: 0.55,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
