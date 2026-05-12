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
} from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { detectDocumentInFrame, nativeProcessImage } from '../src/utils/cvProcessor';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, CONFIG } from '../src/config';
import { useScanStore } from '../src/store/scanStore';
import { useCVAutoCapture } from '../src/hooks/useCVAutoCapture';
import { CVProcessingResult } from '../src/utils/cvProcessor';
import { StatusIndicator } from '../src/components/StatusIndicator';
import { ThumbnailStrip } from '../src/components/ThumbnailStrip';
import { CaptureButton } from '../src/components/CaptureButton';
import { ScannedPage } from '../src/types';
import { detectBlur, getSharpnessColor, BlurDetectionResult } from '../src/utils/blurDetection';

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

  // Live Frame Processing Loop
  const isProcessingFrame = useRef(false);
  useEffect(() => {
    // STABILITY: Fully bypass live loop if disabled
    if (!ENABLE_LIVE_DETECTION || !isCameraReady || isPaused || isCapturing) return;

    const intervalId = setInterval(async () => {
      if (isProcessingFrame.current || !cameraRef.current) return;
      
      try {
        isProcessingFrame.current = true;
        // Take a low-resolution frame purely for CV analysis
        // MEMORY: Use minimal settings to prevent activity death
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.3, // Stabilized quality
          base64: false, // Reduced memory pressure
          shutterSound: false,
          skipProcessing: true,
        });

        // Skip processing if base64 is disabled for stability
        if (photo?.uri && ENABLE_LIVE_DETECTION) {
           // If we ever re-enable, we'd need to convert uri to base64 here or modify detectDocumentInFrame
           // But for now, we are DISABLING the loop.
        }
      } catch (err) {
        console.warn('[Scanner] Live frame error (silently handled):', err);
      } finally {
        isProcessingFrame.current = false;
      }
    }, 1000); // Increased throttle to 1 FPS for stability

    return () => {
      if (intervalId) clearInterval(intervalId);
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

  /**
   * Process a scanned image - check for blur and add to session
   */
  const processScannedImage = async (imageUri: string) => {
    // Show blur check modal
    setBlurCheckModal({
      visible: true,
      imageUri,
      blurResult: null,
      isChecking: true,
    });

    // Check for blur
    const blurResult = await detectBlur(imageUri);
    
    setBlurCheckModal(prev => ({
      ...prev,
      blurResult,
      isChecking: false,
    }));

    // If image is very blurry, show warning and wait for user decision
    if (blurResult.level === 'very_blurry') {
      // Don't auto-add, let user decide
      return;
    }

    // If acceptable or sharp, auto-add after brief delay
    if (blurResult.level === 'sharp' || blurResult.level === 'acceptable') {
      setTimeout(() => {
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
    try {
      if (!FileSystem.cacheDirectory) {
        throw new Error('FileSystem.cacheDirectory is unavailable');
      }

      // Process and compress image natively for speed
      let inputForProcess: string;
      if (imageUri.startsWith('file://')) {
        inputForProcess = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        inputForProcess = imageUri;
      }

      const processed = await nativeProcessImage(inputForProcess, {
        targetWidth: CONFIG.IMAGE_TARGET_WIDTH,
        grayscale: true,
        enhance: true, // Enable real enhancement pipeline
        autoCrop: autoCropEnabled,
      });

      if (!processed.base64 || processed.base64.length === 0) {
        throw new Error('Image processing returned empty data');
      }

      const fileSizeBytes = Math.round((processed.base64.length * 3) / 4);

      // Save the native processed image to a permanent file
      // We use documentDirectory because cacheDirectory can be purged by the OS
      const processedUri = `${FileSystem.documentDirectory}scanned_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(processedUri, processed.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      let pageNumber = 1;
      if (currentPhase === 'question_paper') {
        const pages = currentSession?.question_paper.pages || [];
        pageNumber = pages.length > 0 ? Math.max(...pages.map(p => p.page_number)) + 1 : 1;
      } else if (currentPhase === 'model_answer') {
        const pages = currentSession?.model_answer.pages || [];
        pageNumber = pages.length > 0 ? Math.max(...pages.map(p => p.page_number)) + 1 : 1;
      } else {
        const student = currentSession?.students[currentStudentIndex];
        const pages = student?.pages || [];
        pageNumber = pages.length > 0 ? Math.max(...pages.map(p => p.page_number)) + 1 : 1;
      }

      const scannedPage: ScannedPage = {
        page_number: pageNumber,
        file_path: processedUri,
        file_size: fileSizeBytes,
        is_blurry: blurResult.isBlurry,
        sharpness_score: blurResult.sharpnessScore,
        captured_at: new Date().toISOString(),
      };

      addPage(scannedPage);
      console.log('Page added:', pageNumber, 'Sharpness:', blurResult.sharpnessScore);
    } catch (error) {
      reportCaptureFailure('addImageToSession', error);
    }
  };

  /**
   * Manual capture (fallback without document scanner)
   */
  const handleManualCapture = useCallback(async () => {
    if (isCapturing || !cameraRef.current || isPaused || !isCameraReady) {
      return;
    }
    
    const now = Date.now();
    if (now - lastCaptureTime < CONFIG.COOLDOWN_AFTER_CAPTURE_MS) return;
    
    setIsCapturing(true);
    setLastCaptureTime(now);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      // Manual capture remains high quality but optimized
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4, // AGGRESSIVE STABILITY: Lower quality to prevent native process OOM
        shutterSound: false,
        skipProcessing: true, // Let our native pipeline handle it
      });

      if (!photo || !photo.uri) {
        throw new Error('Failed to capture photo');
      }

      // Process the captured image with blur check
      await processScannedImage(photo.uri);

    } catch (error: any) {
      console.error('Capture error:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Ensure we don't crash the whole screen on capture failure
      Alert.alert('Capture Failed', error?.message || 'The camera was unable to take a picture. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, lastCaptureTime, isPaused, isCameraReady]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    nextStudent();
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
      default: return `STUDENT #${currentStudentIndex + 1}`;
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

  return (
    <View style={styles.container}>
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

      {/* Controls */}
      <SafeAreaView edges={['bottom']} style={styles.controlsSafeArea}>
        <ScrollView 
          style={styles.controlsScrollView}
          contentContainerStyle={styles.controlsContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Primary Action: Document Scanner with Auto-Crop */}
          <TouchableOpacity
            style={styles.scanButton}
            onPress={handleDocumentScan}
            disabled={isCapturing}
          >
            <Ionicons name="scan" size={24} color="#fff" />
            <Text style={styles.scanButtonText}>
              SCAN WITH AUTO-CROP
            </Text>
          </TouchableOpacity>

          {/* Secondary: Manual Capture Row */}
          <View style={styles.manualCaptureRow}>
            {autoCaptureEnabled && (
              <TouchableOpacity
                style={[styles.pausePlayButton, isPaused && styles.playButton]}
                onPress={togglePause}
              >
                <Ionicons name={isPaused ? 'play' : 'pause'} size={20} color="#fff" />
              </TouchableOpacity>
            )}

            <CaptureButton
              onPress={handleManualCapture}
              stabilityProgress={isPaused ? 0 : captureState.stabilityProgress}
              disabled={isCapturing || isPaused || !isCameraReady}
              autoCaptureEnabled={autoCaptureEnabled && !isPaused && isCameraReady}
            />

            <TouchableOpacity
              style={[styles.undoButton, currentPages.length === 0 && styles.undoButtonDisabled]}
              onPress={handleUndo}
              disabled={currentPages.length === 0}
            >
              <Ionicons
                name="arrow-undo"
                size={18}
                color={currentPages.length > 0 ? '#fff' : 'rgba(255,255,255,0.3)'}
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.orText}>or tap capture button for manual mode</Text>

          {/* Phase Actions / Next Student Button */}
          {currentPhase === 'students' ? (
            <TouchableOpacity style={styles.nextStudentButton} onPress={handleNextStudent}>
              <Ionicons name="person-add" size={22} color="#fff" />
              <Text style={styles.nextStudentText}>NEXT STUDENT</Text>
              <Text style={styles.nextStudentCount}>(#{currentStudentIndex + 2})</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.phaseActions}>
              <TouchableOpacity style={styles.skipButton} onPress={handleSkipPhase}>
                <Ionicons name="play-skip-forward" size={18} color={COLORS.textMuted} />
                <Text style={styles.skipButtonText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nextPhaseButton} onPress={handleNextPhase}>
                <Text style={styles.nextPhaseText}>
                  Done with {currentPhase === 'question_paper' ? 'QP' : 'Model'}
                </Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Done Button */}
          {currentPhase === 'students' && (
            <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
              <Ionicons name="checkmark-done-circle" size={24} color="#fff" />
              <Text style={styles.doneButtonText}>DONE - Review All</Text>
            </TouchableOpacity>
          )}

          {/* Settings Row */}
          <View style={styles.settingsRow}>
            <TouchableOpacity
              style={[styles.settingButton, autoCaptureEnabled && styles.settingButtonActive]}
              onPress={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
            >
              <Ionicons 
                name="flash" 
                size={16} 
                color={autoCaptureEnabled ? '#fff' : COLORS.textMuted} 
              />
              <Text style={[styles.settingButtonText, autoCaptureEnabled && { color: '#fff' }]}>
                Auto {autoCaptureEnabled ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
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
});
