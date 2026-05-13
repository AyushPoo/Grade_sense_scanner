import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { detectDocumentInFrame, nativeProcessImage } from '../src/utils/cvProcessor';
import { generateUUID } from '../src/store/scanStore';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system';
import { COLORS, CONFIG } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { useCVAutoCapture } from '../src/hooks/useCVAutoCapture';
import { CVProcessingResult } from '../src/utils/cvProcessor';
import { StatusIndicator } from '../src/components/StatusIndicator';
import { ThumbnailStrip } from '../src/components/ThumbnailStrip';
import { CaptureButton } from '../src/components/CaptureButton';
import { ScannedPage } from '../src/types';
import { detectBlur, getSharpnessColor, BlurDetectionResult } from '../src/utils/blurDetection';
import DocumentScanner from 'react-native-document-scanner-plugin';

// Note: Document Scanner with auto-crop requires Dev Build
// For Expo Go, we use manual capture with blur detection

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function reportCaptureFailure(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Scanner] ${context}:`, message, error);
  Alert.alert('Could not save page', message);
}

// STABILITY HOTFIX: Disable heavy real-time CV loop on real devices
const ENABLE_LIVE_DETECTION = false;

export default function ScannerScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const isMounted = useRef(true);
  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = permission?.granted;
  
  const {
    currentSession,
    currentPhase,
    currentStudentIndex,
    autoCaptureEnabled,
    flashMode,
    setCurrentPhase,
    addPage,
    nextStudent,
    undoLastPage,
    finishSession,
    saveSession,
    setFlashMode,
    setAutoCaptureEnabled,
    autoCropEnabled,
    setAutoCropEnabled,
    clearCurrentSession,
  } = useScanStore();

  const [isCapturing, setIsCapturing] = useState(false);
  const [cvResult, setCvResult] = useState<CVProcessingResult | null>(null);
  const [lastCaptureTime, setLastCaptureTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [screenDimensions, setScreenDimensions] = useState({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  });
  
  // Blur detection state
  const [blurCheckModal, setBlurCheckModal] = useState<{
    visible: boolean;
    imageUri: string;
    blurResult: BlurDetectionResult | null;
    isChecking: boolean;
  }>({
    visible: false,
    imageUri: '',
    blurResult: null,
    isChecking: false,
  });
  
  // Student Identity State
  const [studentIdentityModal, setStudentIdentityModal] = useState({
    visible: false,
    name: '',
    rollNumber: '',
  });

  const [inputLayout, setInputLayout] = useState({ keyboardHeight: 0 });

  // Initial Student Identity Flow
  useEffect(() => {
    if (currentPhase === 'students' && currentSession) {
      const currentStudent = currentSession.students[currentStudentIndex];
      if (currentStudent && !currentStudent.name && !studentIdentityModal.visible) {
        setStudentIdentityModal({
          visible: true,
          name: '',
          rollNumber: '',
        });
      }
    }
  }, [currentPhase, currentSession?.session_id]); // Trigger on phase change or new session

  // Enable auto-rotation for camera
  useEffect(() => {
    const enableRotation = async () => {
      await ScreenOrientation.unlockAsync();
    };
    enableRotation();

    const subscription = ScreenOrientation.addOrientationChangeListener((event) => {
      const { width, height } = Dimensions.get('window');
      setScreenDimensions({ width, height });
      
      if (
        event.orientationInfo.orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        event.orientationInfo.orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
      ) {
        setOrientation('landscape');
      } else {
        setOrientation('portrait');
      }
    });

    return () => {
      isMounted.current = false;
      ScreenOrientation.removeOrientationChangeListener(subscription);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenDimensions({ width: window.width, height: window.height });
    });
    return () => subscription.remove();
  }, []);

  const onCameraReady = useCallback(() => {
    console.log('Camera is ready');
    setIsCameraReady(true);
  }, []);

  // Live Frame Processing Loop - Redesigned for SAFE THROTTLED ANALYSIS
  const isProcessingFrame = useRef(false);
  const frameLoopTimeoutRef = useRef<any>(null);

  useEffect(() => {
    // STABILITY: Fully bypass live loop if disabled
    if (!ENABLE_LIVE_DETECTION || !isCameraReady || isPaused || isCapturing) {
      if (frameLoopTimeoutRef.current) clearTimeout(frameLoopTimeoutRef.current);
      return;
    }

    const processFrame = async () => {
      if (isProcessingFrame.current || !cameraRef.current || isPaused || isCapturing) {
        frameLoopTimeoutRef.current = setTimeout(processFrame, 2000);
        return;
      }
      
      const startTime = Date.now();
      try {
        isProcessingFrame.current = true;
        
        // 1. Capture lightweight frame (Min resolution, low quality)
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.1,
          base64: false,
          shutterSound: false,
          skipProcessing: true,
        });

        if (photo?.uri) {
          const captureTime = Date.now();
          
          // 2. Downscale for CV speed
          const manipulated = await ImageManipulator.manipulateAsync(
            photo.uri,
            [{ resize: { width: 480 } }],
            { base64: true, format: ImageManipulator.SaveFormat.JPEG }
          );

          if (manipulated.base64) {
            // 3. REAL-TIME ANALYSIS
            const result = await detectDocumentInFrame(
              manipulated.base64,
              manipulated.width,
              manipulated.height
            );
            
            const endTime = Date.now();
            console.log(`[CV Engine] Frame processed in ${endTime - startTime}ms (Analysis: ${endTime - captureTime}ms)`);
            
            setCvResult(result);
          }
          
          // Cleanup captured temp file
          const tempFile = new FileSystem.File(photo.uri);
          await tempFile.delete();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[Scanner] Live frame error:', message);
      } finally {
        isProcessingFrame.current = false;
        // Schedule next frame ONLY after current is finished
        frameLoopTimeoutRef.current = setTimeout(processFrame, 2000);
      }
    };

    // Kick off the loop
    frameLoopTimeoutRef.current = setTimeout(processFrame, 1000);

    return () => {
      if (frameLoopTimeoutRef.current) clearTimeout(frameLoopTimeoutRef.current);
      isProcessingFrame.current = false;
    };
  }, [isCameraReady, isPaused, isCapturing]);

  /**
   * Document Scanner with auto-crop (requires Dev Build)
   * Shows message in Expo Go, works in Dev Build
   */
  const handleDocumentScan = async () => {
    Alert.alert(
      'Dev Build Required',
      'The auto-crop feature uses native document scanning which requires a Dev Build.\n\n' +
      'For now, use the manual capture button below. The blur detection will still work!\n\n' +
      'To enable auto-crop, run:\nnpx expo prebuild\nnpx expo run:ios',
      [{ text: 'OK' }]
    );
  };

  const handleCropCancel = () => {
    // No longer needed for native scanner
  };

  const handleCropConfirm = async (corners: { x: number, y: number }[]) => {
    // No longer needed for native scanner
  };

  /**
   * Process a scanned image - check for blur and add to session
   */
  const processScannedImage = async (imageUri: string) => {
    console.log(`[ISOLATION] processScannedImage: START for ${imageUri}`);
    
    // Show blur check modal
    setBlurCheckModal({
      visible: true,
      imageUri,
      blurResult: null,
      isChecking: true,
    });

    // TEST GROUP ISOLATION: Toggle these to find the crash
    const SKIP_BLUR_DETECTION = false;
    const SKIP_PROCESSING = false;

    if (SKIP_BLUR_DETECTION) {
      console.log('[ISOLATION] Skipping blur detection');
      setTimeout(() => {
        void addImageToSession(imageUri, { isBlurry: false, sharpnessScore: 100, level: 'sharp', message: 'Skipped' }).catch((err) =>
          reportCaptureFailure('addImageToSession (auto skipped blur)', err)
        );
        setBlurCheckModal(prev => ({ ...prev, visible: false }));
      }, 1000);
      return;
    }

    // Check for blur
    console.log('[ISOLATION] detectBlur: START');
    const blurResult = await detectBlur(imageUri);
    console.log('[ISOLATION] detectBlur: SUCCESS', blurResult.level);
    
    setBlurCheckModal(prev => ({
      ...prev,
      blurResult,
      isChecking: false,
    }));

    // If image is very blurry, show warning and wait for user decision
    if (blurResult.level === 'very_blurry') {
      return;
    }

    // If acceptable or sharp, auto-add after brief delay
    if (blurResult.level === 'sharp' || blurResult.level === 'acceptable') {
      setTimeout(() => {
        console.log('[ISOLATION] Auto-adding after blur check');
        void addImageToSession(imageUri, blurResult).catch((err) =>
          reportCaptureFailure('addImageToSession (auto after blur check)', err)
        );
        setBlurCheckModal(prev => ({ ...prev, visible: false }));
      }, 1000);
    }
  };

  /**
   * Add the image to the current session
   */
  const addImageToSession = async (imageUri: string, blurResult: BlurDetectionResult) => {
    console.log(`[ISOLATION] addImageToSession: START for ${imageUri}`);
    try {
      // 1. Process image natively
      console.log('[ISOLATION] nativeProcessImage: START');
      const processed = await nativeProcessImage(imageUri, {
        targetWidth: CONFIG.IMAGE_TARGET_WIDTH,
        grayscale: true,
        enhance: true,
        autoCrop: false,
      });

      if (!processed || !processed.uri) {
        throw new Error('Native image processing returned an invalid result');
      }
      
      console.log('[ISOLATION] nativeProcessImage: SUCCESS');

      // 2. Move to permanent storage
      console.log('[ISOLATION] FileSystem.copy: START');
      const filename = `scanned_${Date.now()}.jpg`;
      const processedFile = new FileSystem.File(processed.uri);
      const destinationFile = new FileSystem.File(FileSystem.Paths.document, filename);
      
      await processedFile.copy(destinationFile);
      console.log('[ISOLATION] FileSystem.copy: SUCCESS', destinationFile.uri);

      // 3. Get file info
      const fileSizeBytes = destinationFile.size;
      console.log('[ISOLATION] FileSystem.File.size: SUCCESS', fileSizeBytes);

      const processedUri = destinationFile.uri;
      
      const scannedPage: ScannedPage = {
        id: generateUUID(),
        page_number: 0, // Assigned by store
        file_path: processedUri,
        file_size: fileSizeBytes,
        is_blurry: blurResult.isBlurry,
        sharpness_score: blurResult.sharpnessScore,
        captured_at: new Date().toISOString(),
      };

      addPage(scannedPage);
      console.log('Page added:', scannedPage.id, 'Sharpness:', blurResult.sharpnessScore);
    } catch (error) {
      reportCaptureFailure('addImageToSession', error);
    }
  };

  /**
   * Manual capture (fallback without document scanner)
   */
  const handleManualCapture = useCallback(async () => {
    try {
      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
        croppedImageQuality: 85,
      });

      if (scannedImages && scannedImages.length > 0) {
        await processScannedImage(scannedImages[0]);
      }
    } catch (error: any) {
      console.error('Native scan error:', error);
      Alert.alert('Scan Failed', 'Could not open native scanner. Please ensure you are using a Dev Build.');
    }
  }, []);

  const { captureState, resetCooldown } = useCVAutoCapture({
    enabled: autoCaptureEnabled && !isPaused && isCameraReady && currentPhase !== 'students',
    onCapture: handleManualCapture,
    cvResult,
  });

  const handleFrameEvent = useCallback((result: CVProcessingResult) => {
    setCvResult(result);
  }, []);

  // frame processor removed for expo-camera

  const togglePause = () => {
    setIsPaused(!isPaused);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const getCurrentPages = () => {
    if (!currentSession) return [];
    if (currentPhase === 'question_paper') return currentSession.question_paper.pages;
    if (currentPhase === 'model_answer') return currentSession.model_answer.pages;
    return currentSession.students[currentStudentIndex]?.pages || [];
  };

  const currentPages = getCurrentPages();

  const handleNextStudent = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    // Open identity modal before moving to next student
    setStudentIdentityModal({
      visible: true,
      name: '',
      rollNumber: '',
    });
  };

  const submitStudentIdentity = (skip = false) => {
    if (skip) {
      nextStudent();
    } else {
      nextStudent({
        name: studentIdentityModal.name.trim(),
        roll_number: studentIdentityModal.rollNumber.trim(),
      });
    }
    
    setStudentIdentityModal({ visible: false, name: '', rollNumber: '' });
    resetCooldown();
  };

  const handleNextPhase = () => {
    if (currentPhase === 'question_paper') {
      if (currentSession?.settings.scan_model_answer) {
        setCurrentPhase('model_answer');
      } else {
        setCurrentPhase('students');
      }
    } else if (currentPhase === 'model_answer') {
      setCurrentPhase('students');
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSkipPhase = () => {
    Alert.alert(
      'Skip This Phase?',
      `Skip ${currentPhase === 'question_paper' ? 'Question Paper' : 'Model Answer'} scanning?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', onPress: handleNextPhase },
      ]
    );
  };

  const handleDone = () => {
    saveSession();
    
    Alert.alert(
      'Done Scanning',
      `You have scanned ${currentSession?.students.filter(s => s.page_count > 0).length || 0} students. Review and finalize?`,
      [
        { text: 'Continue Scanning', style: 'cancel' },
        {
          text: 'Review & Finish',
          onPress: () => {
            finishSession();
            router.replace({
              pathname: '/review',
              params: { sessionId: currentSession?.session_id },
            });
          },
        },
      ]
    );
  };

  const handleUndo = () => {
    if (currentPages.length > 0) {
      undoLastPage();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const getPhaseTitle = () => {
    switch (currentPhase) {
      case 'question_paper': return 'QUESTION PAPER';
      case 'model_answer': return 'MODEL ANSWER';
      default: {
        const student = currentSession?.students[currentStudentIndex];
        return student?.label || `STUDENT #${currentStudentIndex + 1}`;
      }
    }
  };

  const getPhaseIndicator = () => {
    const phases = [];
    if (currentSession?.settings.scan_question_paper) phases.push('QP');
    if (currentSession?.settings.scan_model_answer) phases.push('MA');
    phases.push('Students');
    
    let currentIdx = 0;
    if (currentPhase === 'model_answer') currentIdx = phases.indexOf('MA');
    else if (currentPhase === 'students') currentIdx = phases.length - 1;
    
    return { phases, currentIndex: currentIdx };
  };

  const cycleFlash = () => {
    const modes: ('off' | 'on' | 'auto')[] = ['off', 'on', 'auto'];
    const currentIdx = modes.indexOf(flashMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    setFlashMode(nextMode);
  };

  const getScannedStudentsCount = () => {
    return currentSession?.students.filter(s => s.page_count > 0).length || 0;
  };

  // Blur Check Modal - Accept or Retake
  const handleAcceptBlurryImage = () => {
    if (blurCheckModal.imageUri && blurCheckModal.blurResult) {
      void addImageToSession(blurCheckModal.imageUri, blurCheckModal.blurResult).catch((err) =>
        reportCaptureFailure('addImageToSession (accept blurry)', err)
      );
    }
    setBlurCheckModal(prev => ({ ...prev, visible: false }));
  };

  const handleRetakeImage = () => {
    setBlurCheckModal(prev => ({ ...prev, visible: false }));
    // User will take another photo
  };

  // Permission handling
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <View style={styles.permissionContent}>
          <Ionicons name="camera-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            GradeSense Scanner needs camera access to scan documents
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentSession) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Text style={styles.permissionText}>No active session</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const { phases, currentIndex } = getPhaseIndicator();
  const isLandscape = orientation === 'landscape';
  const cameraHeight = isLandscape 
    ? screenDimensions.height * 0.65 
    : screenDimensions.height * 0.38;

  const renderStudentIdentityModal = () => (
    <Modal
      visible={studentIdentityModal.visible}
      transparent
      animationType="slide"
      onRequestClose={() => setStudentIdentityModal({ ...studentIdentityModal, visible: false })}
    >
      <View style={styles.identityOverlay}>
        <View style={styles.identityContent}>
          <Text style={styles.identityTitle}>Student Identity</Text>
          <Text style={styles.identitySubtitle}>Optionally identify the next student</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>STUDENT NAME</Text>
            <View style={styles.textInputWrapper}>
              <Ionicons name="person-outline" size={20} color={COLORS.textMuted} />
              <TextInput
                style={styles.textInput}
                placeholder="Enter Name"
                value={studentIdentityModal.name}
                onChangeText={(text) => setStudentIdentityModal({ ...studentIdentityModal, name: text })}
                autoFocus
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>ROLL NUMBER (OPTIONAL)</Text>
            <View style={styles.textInputWrapper}>
              <Ionicons name="card-outline" size={20} color={COLORS.textMuted} />
              <TextInput
                style={styles.textInput}
                placeholder="Enter Roll Number"
                value={studentIdentityModal.rollNumber}
                onChangeText={(text) => setStudentIdentityModal({ ...studentIdentityModal, rollNumber: text })}
              />
            </View>
          </View>

          <View style={styles.identityActions}>
            <TouchableOpacity 
              style={styles.skipBtn} 
              onPress={() => submitStudentIdentity(true)}
            >
              <Text style={styles.skipBtnText}>Skip</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.continueBtn} 
              onPress={() => submitStudentIdentity(false)}
            >
              <Text style={styles.continueBtnText}>Continue Scanning</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      {renderStudentIdentityModal()}
      {/* Blur Check Modal */}
      <Modal
        visible={blurCheckModal.visible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setBlurCheckModal(prev => ({ ...prev, visible: false }))}
      >
        <View style={styles.blurModalOverlay}>
          <View style={styles.blurModalContent}>
            {blurCheckModal.isChecking ? (
              <View style={styles.blurChecking}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.blurCheckingText}>Analyzing image quality...</Text>
              </View>
            ) : (
              <>
                <Image
                  source={{ uri: blurCheckModal.imageUri }}
                  style={styles.blurPreviewImage}
                  resizeMode="contain"
                />
                
                {blurCheckModal.blurResult && (
                  <View style={styles.blurResultContainer}>
                    <View style={[
                      styles.blurIndicator,
                      { backgroundColor: getSharpnessColor(blurCheckModal.blurResult.level) }
                    ]}>
                      <Ionicons
                        name={blurCheckModal.blurResult.isBlurry ? 'warning' : 'checkmark-circle'}
                        size={24}
                        color="#fff"
                      />
                      <Text style={styles.blurIndicatorText}>
                        {blurCheckModal.blurResult.level.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.blurMessage}>{blurCheckModal.blurResult.message}</Text>
                    <Text style={styles.blurScore}>
                      Sharpness Score: {blurCheckModal.blurResult.sharpnessScore}
                    </Text>
                  </View>
                )}

                {blurCheckModal.blurResult?.isBlurry && (
                  <View style={styles.blurActions}>
                    <TouchableOpacity
                      style={styles.blurRetakeButton}
                      onPress={handleRetakeImage}
                    >
                      <Ionicons name="refresh" size={20} color="#fff" />
                      <Text style={styles.blurButtonText}>Retake</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.blurAcceptButton}
                      onPress={handleAcceptBlurryImage}
                    >
                      <Ionicons name="checkmark" size={20} color="#fff" />
                      <Text style={styles.blurButtonText}>Keep Anyway</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.phaseTitle}>{getPhaseTitle()}</Text>
            <Text style={styles.pageCount}>
              Pages: {currentPages.length}
              {currentPhase === 'students' && ` • Students: ${getScannedStudentsCount()}`}
            </Text>
          </View>
          <View style={styles.pageModeBadge}>
            <Ionicons 
              name={currentSession?.settings.page_mode === 'double' ? 'documents' : 'document'} 
              size={14} 
              color="#fff" 
            />
            <Text style={styles.pageModeBadgeText}>
              {currentSession?.settings.page_mode === 'double' ? '2PG' : '1PG'}
            </Text>
          </View>
          <View style={[styles.orientationBadge, isLandscape && styles.orientationBadgeActive]}>
            <Ionicons 
              name={isLandscape ? 'phone-landscape' : 'phone-portrait'} 
              size={14} 
              color="#fff" 
            />
          </View>
        </View>
        
        {/* Secondary Header / Controls */}
        <View style={styles.secondaryHeader}>
           <TouchableOpacity 
             style={[styles.smallToggle, autoCropEnabled && styles.smallToggleActive]}
             onPress={() => {
               setAutoCropEnabled(!autoCropEnabled);
               Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
             }}
           >
             <Ionicons name="scan-outline" size={16} color={autoCropEnabled ? '#fff' : COLORS.textMuted} />
             <Text style={[styles.smallToggleText, autoCropEnabled && styles.smallToggleTextActive]}>
               AUTO-CROP
             </Text>
           </TouchableOpacity>

           <TouchableOpacity 
             style={[styles.smallToggle, autoCaptureEnabled && styles.smallToggleActive]}
             onPress={() => {
               setAutoCaptureEnabled(!autoCaptureEnabled);
               Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
             }}
           >
             <Ionicons name="flash-outline" size={16} color={autoCaptureEnabled ? '#fff' : COLORS.textMuted} />
             <Text style={[styles.smallToggleText, autoCaptureEnabled && styles.smallToggleTextActive]}>
               AUTO-CAP
             </Text>
           </TouchableOpacity>

           <TouchableOpacity style={styles.smallToggle} onPress={cycleFlash}>
             <Ionicons 
               name={flashMode === 'on' ? 'flashlight' : flashMode === 'auto' ? 'flash' : 'flash-off'} 
               size={16} 
               color="#fff" 
             />
             <Text style={styles.smallToggleText}>{flashMode.toUpperCase()}</Text>
           </TouchableOpacity>
        </View>

        {/* Phase Progress Indicator */}
        <View style={styles.phaseProgress}>
          {phases.map((phase, idx) => (
            <View key={phase} style={styles.phaseItem}>
              <View style={[
                styles.phaseDot,
                idx === currentIndex && styles.phaseDotActive,
                idx < currentIndex && styles.phaseDotDone,
              ]}>
                {idx < currentIndex && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={[
                styles.phaseLabel,
                idx === currentIndex && styles.phaseLabelActive,
              ]}>{phase}</Text>
            </View>
          ))}
        </View>
      </SafeAreaView>

      {/* Camera View */}
      <View style={[styles.cameraContainer, { height: cameraHeight }]}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={onCameraReady}
        />

        {!isCameraReady && (
          <View style={styles.pauseOverlay}>
            <Ionicons name="camera-outline" size={60} color="rgba(255,255,255,0.8)" />
            <Text style={styles.pauseText}>Initializing Camera...</Text>
          </View>
        )}

        {isPaused && isCameraReady && (
          <View style={styles.pauseOverlay}>
            <Ionicons name="pause-circle" size={80} color="rgba(255,255,255,0.8)" />
            <Text style={styles.pauseText}>PAUSED</Text>
          </View>
        )}

        {ENABLE_LIVE_DETECTION && cvResult?.quadrilateral && cvResult?.dimensions && !isPaused && (
           <View style={StyleSheet.absoluteFill} pointerEvents="none">
               <Svg 
                 height="100%" 
                 width="100%" 
                 style={StyleSheet.absoluteFill}
                 viewBox={`0 0 ${cvResult.dimensions.width} ${cvResult.dimensions.height}`}
                 preserveAspectRatio="xMidYMid slice"
               >
                  <Polygon
                    points={`${cvResult.quadrilateral.topLeft.x},${cvResult.quadrilateral.topLeft.y} ${cvResult.quadrilateral.topRight.x},${cvResult.quadrilateral.topRight.y} ${cvResult.quadrilateral.bottomRight.x},${cvResult.quadrilateral.bottomRight.y} ${cvResult.quadrilateral.bottomLeft.x},${cvResult.quadrilateral.bottomLeft.y}`}
                    fill="rgba(46, 204, 113, 0.2)"
                    stroke={COLORS.success}
                    strokeWidth="8"
                    strokeLinejoin="round"
                  />
               </Svg>
           </View>
        )}

        {!cvResult?.quadrilateral && (
          <View style={styles.documentGuide}>
             <View style={styles.guideBorder} />
          </View>
        )}

        <View style={styles.cameraControls}>
          <TouchableOpacity style={styles.cameraControlButton} onPress={cycleFlash}>
            <Ionicons
              name={flashMode === 'on' ? 'flash' : flashMode === 'auto' ? 'flash-outline' : 'flash-off'}
              size={24}
              color="#fff"
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Status Bar */}
      <View style={styles.statusContainer}>
        <StatusIndicator captureState={{ ...captureState, isStable: captureState.isStable && !isPaused }} />
      </View>

      {/* Thumbnails */}
      <View style={styles.thumbnailContainer}>
        <ThumbnailStrip
          pages={currentPages}
          onPagePress={(page) => {
            router.push({
              pathname: '/page-preview',
              params: {
                pageNumber: page.page_number,
                phase: currentPhase,
                studentIndex: currentStudentIndex.toString(),
              },
            });
          }}
        />
      </View>

      {/* Controls Area */}
      <SafeAreaView edges={['bottom']} style={styles.controlsSafeArea}>
        <View style={styles.controlsContainer}>
          {/* Main Action Bar */}
          <View style={styles.mainActionBar}>
            <TouchableOpacity
              style={[styles.miniBtn, isPaused && styles.miniBtnActive]}
              onPress={togglePause}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={24} color="#fff" />
              <Text style={styles.miniBtnLabel}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
            </TouchableOpacity>

            <CaptureButton
              onPress={handleManualCapture}
              stabilityProgress={isPaused ? 0 : captureState.stabilityProgress}
              disabled={isCapturing || isPaused || !isCameraReady}
              autoCaptureEnabled={autoCaptureEnabled && !isPaused && isCameraReady}
            />

            {currentPhase === 'students' ? (
              <TouchableOpacity style={styles.nextStudentAction} onPress={handleNextStudent}>
                <Ionicons name="person-add" size={24} color="#fff" />
                <Text style={styles.nextStudentActionLabel}>NEXT STUDENT</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={[styles.undoButton, currentPages.length === 0 && styles.undoButtonDisabled]}
                onPress={handleUndo}
                disabled={currentPages.length === 0}
              >
                <Ionicons
                  name="arrow-undo"
                  size={20}
                  color={currentPages.length > 0 ? '#fff' : 'rgba(255,255,255,0.3)'}
                />
                <Text style={styles.miniBtnLabel}>UNDO</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Secondary Actions Row */}
          <View style={styles.secondaryActionsRow}>
            {currentPhase !== 'students' ? (
              <TouchableOpacity style={styles.donePhaseBtn} onPress={handleNextPhase}>
                <Text style={styles.donePhaseBtnText}>FINISH {currentPhase === 'question_paper' ? 'QP' : 'MODEL'}</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            ) : (
              <View style={styles.studentStatsRow}>
                <TouchableOpacity style={styles.undoStudentBtn} onPress={handleUndo}>
                   <Ionicons name="arrow-undo" size={16} color="rgba(255,255,255,0.6)" />
                   <Text style={styles.undoStudentBtnText}>Undo Last Page</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.finishSessionBtn} onPress={handleDone}>
                  <Text style={styles.finishSessionBtnText}>FINISH SESSION</Text>
                  <Ionicons name="checkmark-done" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>

      <Modal visible={false} animationType="slide">
        {/* Review modal removed in favor of native scanner UI */}
      </Modal>

      {isCapturing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Processing Scan...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionContent: {
    alignItems: 'center',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backLink: {
    marginTop: 16,
    padding: 8,
  },
  backLinkText: {
    color: COLORS.primary,
    fontSize: 14,
  },
  headerSafeArea: {
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  phaseTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  pageCount: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 2,
  },
  pageModeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginRight: 6,
  },
  pageModeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  orientationBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 6,
    borderRadius: 10,
  },
  orientationBadgeActive: {
    backgroundColor: COLORS.success,
  },
  phaseProgress: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  phaseItem: {
    alignItems: 'center',
    gap: 3,
  },
  phaseDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  smallToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  smallToggleActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  smallToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  smallToggleTextActive: {
    color: '#fff',
  },
  phaseDotActive: {
    backgroundColor: COLORS.primary,
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  phaseDotDone: {
    backgroundColor: COLORS.success,
  },
  phaseLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '600',
  },
  phaseLabelActive: {
    color: '#fff',
  },
  cameraContainer: {
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  pauseText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginTop: 12,
  },
  documentGuide: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  guideBorder: {
    width: '100%',
    height: '100%',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 8,
  },
  guideBorderDetected: {
    borderColor: COLORS.success,
    borderWidth: 3,
  },
  cameraControls: {
    position: 'absolute',
    bottom: 12,
    left: 12,
  },
  cameraControlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContainer: {
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  thumbnailContainer: {
    height: 65,
    backgroundColor: COLORS.background,
    paddingVertical: 4,
  },
  controlsSafeArea: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  controlsScrollView: {
    flex: 1,
  },
  controlsContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.success,
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 10,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  manualCaptureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 4,
  },
  orText: {
    textAlign: 'center',
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 10,
  },
  pausePlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.warning,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    backgroundColor: COLORS.success,
  },
  undoButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  undoButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  nextStudentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.success,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    marginBottom: 8,
  },
  nextStudentText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  nextStudentCount: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
  },
  phaseActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  skipButtonText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  nextPhaseButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
  },
  nextPhaseText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  settingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
  },
  settingButtonActive: {
    backgroundColor: COLORS.primary,
  },
  settingButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  // Refined Controls
  controlsSafeArea: {
    backgroundColor: '#000',
    paddingTop: 10,
  },
  controlsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  mainActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  miniBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  miniBtnActive: {
    backgroundColor: COLORS.primary,
  },
  miniBtnLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  nextStudentAction: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  nextStudentActionLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: '#fff',
    marginTop: 4,
    textAlign: 'center',
  },
  undoButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  undoButtonDisabled: {
    opacity: 0.3,
  },
  secondaryActionsRow: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  donePhaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
  },
  donePhaseBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  studentStatsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  undoStudentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
  },
  undoStudentBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
  },
  finishSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.success,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
  },
  finishSessionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  // Blur Modal Styles
  blurModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  blurModalContent: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 350,
    alignItems: 'center',
  },
  blurChecking: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  blurCheckingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  blurPreviewImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#000',
  },
  blurResultContainer: {
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
  },
  blurIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  blurIndicatorText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  blurMessage: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.text,
    textAlign: 'center',
  },
  blurScore: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textMuted,
  },
  blurActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  blurRetakeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.error,
    paddingVertical: 14,
    borderRadius: 12,
  },
  blurAcceptButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.warning,
    paddingVertical: 14,
    borderRadius: 12,
  },
  blurButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Identity Modal Styles
  identityOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  identityContent: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  identityTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  identitySubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 8,
    letterSpacing: 1,
  },
  textInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 54,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  identityActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  skipBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  skipBtnText: {
    color: COLORS.textLight,
    fontSize: 16,
    fontWeight: '600',
  },
  continueBtn: {
    flex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  continueBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
