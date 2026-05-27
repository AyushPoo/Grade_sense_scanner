import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { useShallow } from 'zustand/react/shallow';
import { ScanSession } from '../src/types';
import { uploadSessionToWebApp } from '../src/api/export';

const WEBAPP_URL = 'https://app.gradesense.in';

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
  const sessionDataFromStore = useScanStore(useShallow(state => 
    state.savedSessions.find(s => s.session_id === sessionId) || null
  ));
  
  const [session, setSession] = useState<ScanSession | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentItem, setCurrentItem] = useState('');
  const [uploadComplete, setUploadComplete] = useState(false);

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
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Upload Failed', 'Failed to upload session. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartUpload = () => {
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

            <View style={styles.nextSteps}>
              <Text style={styles.nextStepsTitle}>Next Steps:</Text>
              <Text style={styles.nextStepsItem}>1. Open GradeSense webapp</Text>
              <Text style={styles.nextStepsItem}>2. Go to the exam</Text>
              <Text style={styles.nextStepsItem}>3. Start AI grading</Text>
            </View>

            <TouchableOpacity
              style={styles.openWebappButton}
              onPress={() => Linking.openURL(WEBAPP_URL)}
            >
              <Ionicons name="globe" size={20} color="#fff" />
              <Text style={styles.openWebappText}>Open GradeSense Webapp</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.homeButton}
              onPress={() => router.replace('/(tabs)/home')}
            >
              <Ionicons name="home" size={20} color={COLORS.primary} />
              <Text style={styles.homeButtonText}>Back to Home</Text>
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
});
