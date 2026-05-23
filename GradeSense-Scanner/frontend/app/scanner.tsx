import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { detectDocumentInFrame } from '../src/utils/cvProcessor';
import { normalizeCapturedDocument } from '../src/utils/documentNormalizer';
import { generateUUID, useScanStore, qualityScore } from '../src/store/scanStore';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import { File, Paths } from 'expo-file-system';
import { COLORS, CONFIG } from '../src/config';
import { useShallow } from 'zustand/react/shallow';
import { CVProcessingResult, Quadrilateral } from '../src/utils/cvProcessor';
import { StatusIndicator, LiveScanStatus } from '../src/components/StatusIndicator';
import { ThumbnailStrip } from '../src/components/ThumbnailStrip';
import { DocumentContourOverlay } from '../src/components/DocumentContourOverlay';
import { ScannerHeader } from '../src/components/ScannerHeader';
import { ProtectedCameraView } from '../src/components/ProtectedCameraView';
import { ScannerBottomBar } from '../src/components/ScannerBottomBar';
import { ScannedPage } from '../src/types';
import { detectBlur, BlurDetectionResult } from '../src/utils/blurDetection';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ENABLE_LIVE_DETECTION = true;
const FRAME_INTERVAL_MS = 500;
const FRAME_PREVIEW_QUALITY = 0.1;
const FRAME_PREVIEW_WIDTH = 480;
const CAPTURE_COOLDOWN_MS = 1500;
const STABILITY_LOCK_THRESHOLD = 3;
const STABILITY_LOST_THRESHOLD = 5;

// ── Simplified workflow — only what we need ───────────────────────────────────
type ScanWorkflow = 'ACTIVE' | 'PAUSED' | 'CAPTURING' | 'COOLDOWN';

export default function ScannerScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const isMounted = useRef(true);
  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = permission?.granted;

  // ── Store ──────────────────────────────────────────────────────────────────
  const currentSessionId   = useScanStore(state => state.currentSession?.session_id);
  const currentPhase       = useScanStore(state => state.currentPhase);
  const currentStudentIndex = useScanStore(state => state.currentStudentIndex);
  const autoCaptureEnabled = useScanStore(state => state.autoCaptureEnabled);
  const flashMode          = useScanStore(state => state.flashMode);
  const pendingRetake      = useScanStore(state => state.pendingRetake);

  const currentPages = useScanStore(useShallow(state => {
    if (!state.currentSession) return [];
    if (state.currentPhase === 'question_paper') return state.currentSession.question_paper.pages;
    if (state.currentPhase === 'model_answer')   return state.currentSession.model_answer.pages;
    return state.currentSession.students[state.currentStudentIndex]?.pages || [];
  }));

  const studentLabel = useScanStore(state =>
    state.currentSession?.students[state.currentStudentIndex]?.label
  );

  const {
    addPage,
    silentNextStudent,
    undoLastPage,
    saveSession,
    setFlashMode,
    setAutoCaptureEnabled,
    clearRetake,
  } = useScanStore(useShallow(state => ({
    addPage:             state.addPage,
    silentNextStudent:   state.silentNextStudent,
    undoLastPage:        state.undoLastPage,
    saveSession:         state.saveSession,
    setFlashMode:        state.setFlashMode,
    setAutoCaptureEnabled: state.setAutoCaptureEnabled,
    clearRetake:         state.clearRetake,
  })));

  // ── Refs (never trigger re-renders) ───────────────────────────────────────
  const workflowRef            = useRef<ScanWorkflow>('ACTIVE');
  const isCapturingRef         = useRef(false);
  const captureCooldownRef     = useRef(false);
  const isPausedRef            = useRef(false);
  const normalizingRef         = useRef(false);
  const isProcessingFrame      = useRef(false);
  const frameLoopRef           = useRef<any>(null);
  const cooldownRef            = useRef<any>(null);
  const lastQuadRef            = useRef<Quadrilateral | null>(null);
  const cvResultRef            = useRef<CVProcessingResult | null>(null);
  const autoCaptureRef         = useRef(autoCaptureEnabled);
  const stableCountRef         = useRef(0);
  const lostCountRef           = useRef(0);
  const isLockedRef            = useRef(false);

  // ── React state (minimal — only what drives render) ───────────────────────
  const [isCameraReady, setIsCameraReady]   = useState(false);
  const [isCapturing, setIsCapturing]       = useState(false);
  const [liveScanStatus, setLiveScanStatus] = useState<LiveScanStatus>('searching');
  const [cvResult, setCvResult]             = useState<CVProcessingResult | null>(null);
  const [isPaused, setIsPaused]             = useState(false);

  // Keep refs in sync
  useEffect(() => { autoCaptureRef.current = autoCaptureEnabled; }, [autoCaptureEnabled]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { cvResultRef.current = cvResult; }, [cvResult]);

  // ── Orientation ────────────────────────────────────────────────────────────
  useEffect(() => {
    ScreenOrientation.unlockAsync();
    const sub = ScreenOrientation.addOrientationChangeListener(() => {});
    return () => {
      isMounted.current = false;
      clearTimeout(cooldownRef.current);
      clearTimeout(frameLoopRef.current);
      ScreenOrientation.removeOrientationChangeListener(sub);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  const onCameraReady = useCallback(() => setIsCameraReady(true), []);

  // ── Frame detection loop ───────────────────────────────────────────────────
  useEffect(() => {
    if (!ENABLE_LIVE_DETECTION || !isCameraReady || !hasPermission) return;

    const processFrame = async () => {
      if (isProcessingFrame.current || !cameraRef.current || isPausedRef.current) {
        frameLoopRef.current = setTimeout(processFrame, 1000);
        return;
      }
      try {
        isProcessingFrame.current = true;
        const photo = await cameraRef.current.takePictureAsync({
          quality: FRAME_PREVIEW_QUALITY, skipProcessing: true, base64: false,
        });
        if (!photo?.uri) return;

        const resized = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: FRAME_PREVIEW_WIDTH } }],
          { base64: true, format: ImageManipulator.SaveFormat.JPEG }
        );
        if (!resized?.base64) return;

        const result = await detectDocumentInFrame(resized.base64, resized.width, resized.height);

        // Stability hysteresis
        if (result.confidence >= 0.7) {
          stableCountRef.current++;
          lostCountRef.current = 0;
          if (stableCountRef.current >= STABILITY_LOCK_THRESHOLD) isLockedRef.current = true;
        } else if (result.confidence <= 0.4) {
          lostCountRef.current++;
          stableCountRef.current = 0;
          if (lostCountRef.current >= STABILITY_LOST_THRESHOLD) isLockedRef.current = false;
        }

        lastQuadRef.current = result.quadrilateral;
        setCvResult(result);

        // Auto-capture: locked + stable + not in cooldown + not already capturing
        if (
          autoCaptureRef.current &&
          isLockedRef.current &&
          result.isStable &&
          !captureCooldownRef.current &&
          !isCapturingRef.current &&
          workflowRef.current === 'ACTIVE'
        ) {
          handleLiveCapture();
        }

        // Update status indicator
        if (!isCapturingRef.current) {
          setLiveScanStatus(isLockedRef.current && result.isStable ? 'detected' : 'searching');
        }

        new File(photo.uri).delete();
      } catch (err) {
        // silent — frame errors are non-fatal
      } finally {
        isProcessingFrame.current = false;
        frameLoopRef.current = setTimeout(processFrame, FRAME_INTERVAL_MS);
      }
    };

    frameLoopRef.current = setTimeout(processFrame, 1000);
    return () => clearTimeout(frameLoopRef.current);
  }, [isCameraReady, hasPermission]);

  // ── Capture ────────────────────────────────────────────────────────────────
  const handleLiveCapture = useCallback(async () => {
    if (isCapturingRef.current || captureCooldownRef.current || !cameraRef.current) return;

    isCapturingRef.current = true;
    workflowRef.current = 'CAPTURING';
    setIsCapturing(true);
    setLiveScanStatus('capturing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7, skipProcessing: true, shutterSound: false,
      });
      if (!photo?.uri) throw new Error('No photo URI');

      const snapshotQuad = lastQuadRef.current;
      const previewDims  = cvResultRef.current?.dimensions || { width: 480, height: 640 };
      const blurResult   = await detectBlur(photo.uri);

      // ── No blur gate — always add. Quality shows in review. ─────────────
      await addImageToSession(photo.uri, blurResult, snapshotQuad, previewDims);

      // Double-vibrate if very blurry so teacher feels it without a popup
      if (blurResult.level === 'very_blurry') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (error) {
      // Silent failure on capture — teacher can undo from bottom bar
      console.warn('Capture error', error);
    } finally {
      isCapturingRef.current = false;
      setIsCapturing(false);
      startCooldown();
    }
  }, []);

  // ── Add page to session ────────────────────────────────────────────────────
  const addImageToSession = async (
    uri: string,
    blur: BlurDetectionResult,
    quad: Quadrilateral | null,
    dims: any,
  ) => {
    if (normalizingRef.current) return;
    normalizingRef.current = true;
    try {
      let finalUri = uri;

      if (quad && quad.topLeft) {
        // Quad detected — do full perspective correction
        try {
          const norm = await normalizeCapturedDocument(uri, quad, dims);
          finalUri = norm.uri;
        } catch (normErr) {
          console.warn('Normalization failed, using raw photo', normErr);
          finalUri = uri;
        }
      } else {
        // No quad — just resize to a consistent size, skip warp
        const resized = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
        );
        finalUri = resized.uri;
      }

      const filename = `scanned_${Date.now()}.jpg`;
      const dest = new File(Paths.document, filename);
      new File(finalUri).copy(dest);

      addPage({
        id:              generateUUID(),
        ui_id:           '',
        page_number:     0,           // store assigns correct number
        file_path:       dest.uri,
        file_size:       dest.size || 0,
        is_blurry:       blur.isBlurry,
        sharpness_score: blur.sharpnessScore,
        captured_at:     new Date().toISOString(),
      });

      setLiveScanStatus('saved');
      setTimeout(() => {
        if (isMounted.current) setLiveScanStatus('searching');
      }, 1500);
    } catch (e) {
      console.warn('addImageToSession error', e);
    } finally {
      normalizingRef.current = false;
    }
  };

  // ── Cooldown ───────────────────────────────────────────────────────────────
  const startCooldown = () => {
    captureCooldownRef.current = true;
    workflowRef.current = 'COOLDOWN';
    cooldownRef.current = setTimeout(() => {
      if (!isMounted.current) return;
      captureCooldownRef.current = false;
      if (!isPausedRef.current) workflowRef.current = 'ACTIVE';
    }, CAPTURE_COOLDOWN_MS);
  };

  // ── Next student — silent, zero interruption ───────────────────────────────
  const handleNextStudent = useCallback(() => {
    silentNextStudent();
    // brief haptic pulse so teacher feels the advance
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [silentNextStudent]);

  // ── Pause / Resume ─────────────────────────────────────────────────────────
  const handleTogglePause = useCallback(() => {
    setIsPaused(prev => {
      const next = !prev;
      isPausedRef.current = next;
      workflowRef.current = next ? 'PAUSED' : 'ACTIVE';
      return next;
    });
  }, []);

  // ── Retake banner (shown when review sends teacher back for a specific page) ─
  const retakeBanner = pendingRetake ? (
    <View style={styles.retakeBanner}>
      <Text style={styles.retakeText}>
        Retaking page {pendingRetake.originalPageNumber} — point at the paper and hold steady
      </Text>
      <TouchableOpacity onPress={clearRetake} style={styles.retakeCancel}>
        <Text style={styles.retakeCancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  // ── Phase label ────────────────────────────────────────────────────────────
  const phaseLabel = () => {
    if (pendingRetake) return `Retake · ${studentLabel ?? ''}`;
    if (currentPhase === 'question_paper') return 'Question paper';
    if (currentPhase === 'model_answer')   return 'Model answer';
    return studentLabel ?? `Student #${currentStudentIndex + 1}`;
  };

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera permission needed</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScannerHeader
        phaseTitle={phaseLabel()}
        pageCount={currentPages.length}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        showStudentCount={currentPhase === 'students'}
        pageMode="single"
        isLandscape={false}
        onBack={() => router.back()}
      />

      <ProtectedCameraView
        cameraRef={cameraRef}
        cameraHeight={SCREEN_HEIGHT * 0.7}
        isCameraReady={isCameraReady}
        isPaused={isPaused}
        onCameraReady={onCameraReady}
        flashMode={flashMode}
      />

      {ENABLE_LIVE_DETECTION && (
        <DocumentContourOverlay
          quadrilateral={cvResult?.quadrilateral ?? null}
          dimensions={cvResult?.dimensions}
          captureReadiness={(cvResult?.confidence || 0) * 100}
          isStable={cvResult?.isStable || false}
          isPaused={isPaused}
        />
      )}

      {retakeBanner}

      <ScannerBottomBar
        currentPagesCount={currentPages.length}
        onManualCapture={handleLiveCapture}
        onNextStudent={handleNextStudent}
        onUndo={undoLastPage}
        onFinishSession={() => {
          saveSession();
          router.replace('/review');
        }}
        isCapturing={isCapturing}
        isPaused={isPaused}
        currentPhase={currentPhase}
        isCameraReady={isCameraReady}
        autoCaptureEnabled={autoCaptureEnabled}
        stabilityProgress={0}
        onTogglePause={handleTogglePause}
        onFinishPhase={() => {}}
      />

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
  retakeBanner: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(239,159,39,0.92)',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  retakeText: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  retakeCancel: {
    paddingLeft: 12,
  },
  retakeCancelText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  permissionButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 999,
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
