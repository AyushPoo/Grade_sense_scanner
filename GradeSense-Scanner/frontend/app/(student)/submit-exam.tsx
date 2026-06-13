import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Image,
  Dimensions,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { COLORS } from '../../src/config';
import { getBackendUrl } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { ProtectedCameraView } from '../../src/components/ProtectedCameraView';
import { submitStudentExam } from '../../src/api/studentPortal';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ScannedPage {
  id: string;
  uri: string;
  originalUri: string;
  page_number: number;
  filter: 'original' | 'grayscale' | 'high_contrast';
}

export default function SubmitExamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { examId, examName } = useLocalSearchParams<{ examId: string; examName: string }>();
  const token = useAuthStore(state => state.sessionToken);

  // Permissions & Camera Refs
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  
  // App states
  const [activeMode, setActiveMode] = useState<'capture' | 'review'>('capture');
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  
  // Photo viewer modal state
  const [selectedPage, setSelectedPage] = useState<ScannedPage | null>(null);
  const [isProcessingFilter, setIsProcessingFilter] = useState(false);

  // Upload/Submit State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ text: '', value: 0 });

  // Reset page numbers whenever pages change
  useEffect(() => {
    setPages(prev =>
      prev.map((p, index) => ({
        ...p,
        page_number: index + 1,
      }))
    );
  }, [pages.length]);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Ionicons name="camera-outline" size={80} color={COLORS.textMuted} />
        <Text style={styles.permTitle}>Camera Permission Required</Text>
        <Text style={styles.permDesc}>
          GradeSense requires access to your camera to scan your exam answer sheets.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission} activeOpacity={0.8}>
          <Text style={styles.permBtnText}>Allow Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Capture Flow ---
  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing) return;

    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        skipProcessing: true,
      });

      if (!photo?.uri) throw new Error('No image captured.');

      // Run high-contrast filter on-the-fly
      const filterResult = await runHighContrastFilter(photo.uri);
      
      const newPage: ScannedPage = {
        id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        uri: filterResult,
        originalUri: photo.uri,
        page_number: pages.length + 1,
        filter: 'high_contrast',
      };

      setPages(prev => [...prev, newPage]);
    } catch (err: any) {
      Alert.alert('Capture Failed', err.message || 'Could not capture photo.');
    } finally {
      setIsCapturing(false);
    }
  };

  const runHighContrastFilter = async (imageUri: string): Promise<string> => {
    try {
      // Dynamic import to cvProcessor to avoid bundling/load overhead if camera is closed
      const { applyFilter } = await import('../../src/utils/cvProcessor');
      return await applyFilter(imageUri, 'high_contrast');
    } catch (err) {
      console.warn('[StudentSubmit] Filter error, fallback to original:', err);
      return imageUri;
    }
  };

  // --- Document Picker Flow ---
  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];

      if (asset.mimeType === 'application/pdf') {
        // Clear camera list and use single PDF
        Alert.alert(
          'Import PDF Document',
          'Importing a PDF will replace any current scanned pages. Proceed?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Import',
              onPress: () => {
                const newPage: ScannedPage = {
                  id: `pdf_${Date.now()}`,
                  uri: asset.uri,
                  originalUri: asset.uri,
                  page_number: 1,
                  filter: 'original',
                };
                setPages([newPage]);
                setActiveMode('review');
              },
            },
          ]
        );
      } else {
        // Image import
        const filterResult = await runHighContrastFilter(asset.uri);
        const newPage: ScannedPage = {
          id: `page_${Date.now()}`,
          uri: filterResult,
          originalUri: asset.uri,
          page_number: pages.length + 1,
          filter: 'high_contrast',
        };
        setPages(prev => [...prev, newPage]);
        setActiveMode('review');
      }
    } catch (err) {
      Alert.alert('Import Failed', 'Unable to pick the selected document.');
    }
  };

  // --- Image Page Operations ---
  const handleRotatePage = async (page: ScannedPage) => {
    try {
      setIsProcessingFilter(true);
      const manipulated = await ImageManipulator.manipulateAsync(
        page.uri,
        [{ rotate: 90 }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      
      const manipulatedOriginal = await ImageManipulator.manipulateAsync(
        page.originalUri,
        [{ rotate: 90 }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      const updated = {
        ...page,
        uri: manipulated.uri,
        originalUri: manipulatedOriginal.uri,
      };

      setPages(prev => prev.map(p => (p.id === page.id ? updated : p)));
      setSelectedPage(updated);
    } catch (err) {
      Alert.alert('Rotation Failed', 'Could not rotate page.');
    } finally {
      setIsProcessingFilter(false);
    }
  };

  const handleToggleFilter = async (page: ScannedPage) => {
    try {
      setIsProcessingFilter(true);
      const nextFilter: 'original' | 'grayscale' | 'high_contrast' = 
        page.filter === 'high_contrast' 
          ? 'grayscale' 
          : page.filter === 'grayscale' 
            ? 'original' 
            : 'high_contrast';

      let newUri = page.originalUri;
      if (nextFilter !== 'original') {
        const { applyFilter } = await import('../../src/utils/cvProcessor');
        newUri = await applyFilter(page.originalUri, nextFilter);
      }

      const updated = {
        ...page,
        uri: newUri,
        filter: nextFilter,
      };

      setPages(prev => prev.map(p => (p.id === page.id ? updated : p)));
      setSelectedPage(updated);
    } catch (err) {
      Alert.alert('Filter Failed', 'Could not apply selected filter.');
    } finally {
      setIsProcessingFilter(false);
    }
  };

  const handleDeletePage = (pageId: string) => {
    Alert.alert('Delete Page', 'Are you sure you want to remove this page?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setPages(prev => prev.filter(p => p.id !== pageId));
          setSelectedPage(null);
        },
      },
    ]);
  };

  // --- Upload and Submit Pipeline ---
  const handleSubmit = async () => {
    if (pages.length === 0) {
      Alert.alert('No Pages Scanned', 'Please capture or import your answer sheets first.');
      return;
    }

    Alert.alert(
      'Submit Answer Sheet',
      `Submit ${pages.length} page(s) for ${examName}? You can resubmit later if needed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: executeUploadPipeline },
      ]
    );
  };

  const executeUploadPipeline = async () => {
    const backendUrl = getBackendUrl();
    if (!token || !backendUrl) {
      Alert.alert('Error', 'Session details or server connection is missing.');
      return;
    }

    setIsSubmitting(true);
    const sessionId = `stud_sub_${examId}_${useAuthStore.getState().user?.user_id || 'unknown'}_${Date.now()}`;
    const uploadedPages = [];

    try {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        setUploadProgress({
          text: `Uploading page ${i + 1} of ${pages.length}...`,
          value: (i / pages.length) * 0.8,
        });

        const fileUri = page.uri;
        const isPdf = fileUri.toLowerCase().endsWith('.pdf');

        const formData = new FormData();
        formData.append('page_number', String(i + 1));
        formData.append('phase', 'students');
        formData.append('student_index', '0');
        formData.append('mode', page.filter);
        
        const fileObj = {
          uri: fileUri,
          name: isPdf ? `sub_page_${i + 1}.pdf` : `sub_page_${i + 1}.jpg`,
          type: isPdf ? 'application/pdf' : 'image/jpeg',
        } as any;
        formData.append('file', fileObj);

        const uploadRes = await fetch(`${backendUrl}/api/scan-sessions/${sessionId}/upload-file`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          body: formData,
        });

        if (!uploadRes.ok) {
          const errBody = await uploadRes.json().catch(() => ({}));
          throw new Error(errBody.detail || `Failed to upload page ${i + 1}`);
        }

        const uploadData = await uploadRes.json();
        
        // Fetch file size for metadata completeness
        let fileSize = 0;
        try {
          const fileInfo = await FileSystem.getInfoAsync(fileUri);
          if (fileInfo.exists) fileSize = fileInfo.size;
        } catch (_) {}

        uploadedPages.push({
          page_number: i + 1,
          file_path: uploadData.filename,
          file_size: fileSize,
          is_blurry: false,
          sharpness_score: 100,
          captured_at: new Date().toISOString(),
          file_url: uploadData.file_url,
          content_type: isPdf ? 'application/pdf' : 'image/jpeg',
          original_name: uploadData.original_name,
        });
      }

      setUploadProgress({
        text: 'Compiling papers & sending to teacher...',
        value: 0.85,
      });

      const response = await submitStudentExam({ token }, examId!, {
        session_id: sessionId,
        pages: uploadedPages,
      });

      setUploadProgress({
        text: 'Submission Successful!',
        value: 1.0,
      });

      setTimeout(() => {
        setIsSubmitting(false);
          Alert.alert('Success', 'Your answer sheet has been submitted successfully!', [
            { text: 'OK', onPress: () => router.replace('/(student)/exams' as any) },
          ]);
      }, 800);

    } catch (err: any) {
      console.error('[StudentUpload] Pipeline failed:', err);
      setIsSubmitting(false);
      Alert.alert('Submission Failed', err.message || 'An error occurred during submission.');
    }
  };

  // --- Rendering ---
  return (
    <View style={styles.container}>
      {activeMode === 'capture' ? (
        // CAMERA CAPTURE MODE
        <View style={styles.flex1}>
          <ProtectedCameraView
            cameraRef={cameraRef}
            onCameraReady={() => setIsCameraReady(true)}
            isCameraReady={isCameraReady}
            isPaused={false}
            flashMode={flashMode}
            style={StyleSheet.absoluteFill}
          />

          {/* Top Floating Controls */}
          <View style={[styles.topControls, { top: insets.top + 10 }]}>
            <TouchableOpacity style={styles.iconBtnBack} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.titleContainer}>
              <Text style={styles.titleText}>{examName || 'Scan exam'}</Text>
              <Text style={styles.subtitleText}>{pages.length} page(s) scanned</Text>
            </View>
            <TouchableOpacity
              style={styles.iconBtnTop}
              onPress={() =>
                setFlashMode(prev => (prev === 'on' ? 'auto' : prev === 'auto' ? 'off' : 'on'))
              }
            >
              <Ionicons
                name={
                  flashMode === 'on'
                    ? 'flash'
                    : flashMode === 'auto'
                      ? 'flash-outline'
                      : 'flash-off'
                }
                size={22}
                color={flashMode === 'on' ? '#FFD700' : '#fff'}
              />
            </TouchableOpacity>
          </View>

          {/* Bottom Controls */}
          <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 20 }]}>
            {/* Gallery Pick */}
            <TouchableOpacity style={styles.sideBtn} onPress={handlePickDocument}>
              <Ionicons name="document-text-outline" size={26} color="#fff" />
              <Text style={styles.sideBtnText}>PDF/Gallery</Text>
            </TouchableOpacity>

            {/* Shutter */}
            <TouchableOpacity
              style={[styles.shutterBtn, isCapturing && styles.shutterBtnDisabled]}
              onPress={handleCapture}
              disabled={isCapturing}
              activeOpacity={0.85}
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            {/* Done/Review */}
            <TouchableOpacity
              style={[styles.sideBtn, pages.length === 0 && styles.sideBtnDisabled]}
              onPress={() => pages.length > 0 && setActiveMode('review')}
              disabled={pages.length === 0}
            >
              <Ionicons name="eye-outline" size={26} color="#fff" />
              <Text style={styles.sideBtnText}>Review ({pages.length})</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // REVIEW & SUBMIT MODE
        <View style={styles.flex1}>
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={styles.headerBack} onPress={() => setActiveMode('capture')}>
              <Ionicons name="camera" size={22} color={COLORS.primary} />
              <Text style={styles.headerBackText}>Scan more</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Review pages</Text>
            <View style={{ width: 80 }} />
          </View>

          {/* Grid list of pages */}
          {pages[0]?.uri.toLowerCase().endsWith('.pdf') ? (
            // PDF mode
            <View style={styles.pdfPlaceholder}>
              <Ionicons name="document" size={80} color={COLORS.error} />
              <Text style={styles.pdfName}>Imported PDF Document</Text>
              <Text style={styles.pdfMeta}>Ready to submit as answer sheet</Text>
              <TouchableOpacity
                style={styles.pdfReplaceBtn}
                onPress={() => setPages([])}
              >
                <Text style={styles.pdfReplaceText}>Remove PDF</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Image list
            <FlatList
              data={pages}
              numColumns={2}
              contentContainerStyle={styles.listContent}
              columnWrapperStyle={styles.listColumn}
              keyExtractor={item => item.id}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={styles.thumbnailCard}
                  activeOpacity={0.9}
                  onPress={() => setSelectedPage(item)}
                >
                  <Image source={{ uri: item.uri }} style={styles.thumbnailImg} />
                  <View style={styles.pageBadge}>
                    <Text style={styles.pageBadgeText}>{index + 1}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteBadge}
                    onPress={() => handleDeletePage(item.id)}
                  >
                    <Ionicons name="close-circle" size={22} color="#EF4444" />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <Ionicons name="images-outline" size={60} color={COLORS.textMuted} />
                  <Text style={styles.emptyListText}>No pages scanned yet.</Text>
                </View>
              }
            />
          )}

          {/* Bottom Submit Toolbar */}
          <View style={[styles.submitToolbar, { paddingBottom: insets.bottom + 15 }]}>
            <TouchableOpacity style={styles.btnPickDoc} onPress={handlePickDocument}>
              <Ionicons name="folder-open" size={20} color={COLORS.text} />
              <Text style={styles.btnPickDocText}>Import</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSubmit, pages.length === 0 && styles.btnSubmitDisabled]}
              onPress={handleSubmit}
              disabled={pages.length === 0}
            >
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={styles.btnSubmitText}>SUBMIT TO TEACHER</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* FULL PREVIEW MODAL */}
      <Modal visible={!!selectedPage} transparent animationType="fade">
        <View style={styles.modalBg}>
          <SafeAreaView style={styles.modalContainer}>
            {/* Top Toolbar */}
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedPage(null)} style={styles.modalClose}>
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Page {selectedPage?.page_number}</Text>
              <View style={{ width: 40 }} />
            </View>

            {/* Preview Image */}
            {selectedPage && (
              <View style={styles.modalPreviewContainer}>
                {isProcessingFilter ? (
                  <ActivityIndicator size="large" color="#fff" />
                ) : (
                  <Image source={{ uri: selectedPage.uri }} style={styles.modalImg} resizeMode="contain" />
                )}
              </View>
            )}

            {/* Bottom Actions */}
            {selectedPage && (
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalFooterBtn}
                  onPress={() => handleRotatePage(selectedPage)}
                  disabled={isProcessingFilter}
                >
                  <Ionicons name="refresh" size={22} color="#fff" />
                  <Text style={styles.modalFooterBtnText}>Rotate</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalFooterBtn}
                  onPress={() => handleToggleFilter(selectedPage)}
                  disabled={isProcessingFilter}
                >
                  <Ionicons name="color-palette" size={22} color="#fff" />
                  <Text style={styles.modalFooterBtnText}>
                    Filter ({selectedPage.filter.replace('_', ' ')})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalFooterBtn, styles.modalFooterBtnDel]}
                  onPress={() => handleDeletePage(selectedPage.id)}
                  disabled={isProcessingFilter}
                >
                  <Ionicons name="trash" size={22} color="#EF4444" />
                  <Text style={[styles.modalFooterBtnText, { color: '#EF4444' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* UPLOAD PROGRESS MODAL */}
      <Modal visible={isSubmitting} transparent>
        <View style={styles.uploadModalBg}>
          <View style={styles.uploadModalContent}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.uploadTitle}>Submitting Exam</Text>
            <Text style={styles.uploadSubtitle}>{uploadProgress.text}</Text>
            
            {/* Progress bar */}
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${uploadProgress.value * 100}%` }]} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex1: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  // Permissions Styling
  permTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 20,
  },
  permDesc: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
    marginBottom: 30,
  },
  permBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  permBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: 14,
    marginTop: 10,
  },
  cancelBtnText: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
  // Camera Mode Styling
  topControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  iconBtnBack: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    alignItems: 'center',
    flex: 1,
  },
  titleText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitleText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  iconBtnTop: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flashAutoText: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingTop: 15,
  },
  shutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#fff',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterBtnDisabled: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
  sideBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  sideBtnDisabled: {
    opacity: 0.4,
  },
  sideBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  // Review Mode Styling
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBackText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  listContent: {
    padding: 12,
    backgroundColor: COLORS.backgroundDark,
    flexGrow: 1,
  },
  listColumn: {
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  thumbnailCard: {
    width: (SCREEN_WIDTH - 36) / 2,
    height: ((SCREEN_WIDTH - 36) / 2) * 1.35,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    position: 'relative',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
  },
  pageBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  deleteBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyListText: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  submitToolbar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  btnPickDoc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderColor: COLORS.border,
    borderWidth: 1,
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
  },
  btnPickDocText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  btnSubmit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnSubmitDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  btnSubmitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  // PDF Mode Styling
  pdfPlaceholder: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pdfName: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 20,
    textAlign: 'center',
  },
  pdfMeta: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 6,
    textAlign: 'center',
  },
  pdfReplaceBtn: {
    marginTop: 30,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderColor: COLORS.error,
    borderWidth: 1,
    borderRadius: 8,
  },
  pdfReplaceText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '700',
  },
  // Modal Preview Styling
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  modalContainer: {
    flex: 1,
    paddingTop: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalClose: {
    padding: 4,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  modalPreviewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImg: {
    width: '100%',
    height: '100%',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#111',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  modalFooterBtn: {
    alignItems: 'center',
    gap: 6,
    minWidth: 80,
  },
  modalFooterBtnDel: {
    // Delete style
  },
  modalFooterBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // Uploading Progress Modal Styling
  uploadModalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  uploadModalContent: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 30,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  uploadTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 16,
  },
  uploadSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 6,
    marginBottom: 20,
    textAlign: 'center',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: COLORS.primaryXLight,
    width: '100%',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
  },
});
