// app/scanner.tsx — complete rewrite
// FIXES:
//   1. Layout: flex-based, no hardcoded SCREEN_HEIGHT * 0.7 — works on all Android
//   2. ThumbnailStrip: rendered inline above bottom bar (like WhatsApp/camera roll)
//   3. Auto-capture: addPageRef fixes stale closure — auto saves correctly now
//   4. Filter picker: shown after manual capture (Original/Enhanced/B&W/High Contrast)
//   5. Students: undefined fixed — phaseLabel reads from store correctly

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { detectDocumentInFrame, convertToGrayscale } from '../src/utils/cvProcessor';
import { normalizeCapturedDocument } from '../src/utils/documentNormalizer';
import { generateUUID, useScanStore } from '../src/store/scanStore';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import { File, Paths } from 'expo-file-system';
import { COLORS } from '../src/config';
import { useShallow } from 'zustand/react/shallow';
import { CVProcessingResult, Quadrilateral } from '../src/utils/cvProcessor';
import { LiveScanStatus } from '../src/components/StatusIndicator';
import { DocumentContourOverlay } from '../src/components/DocumentContourOverlay';
import { ScannerHeader } from '../src/components/ScannerHeader';
import { ProtectedCameraView } from '../src/components/ProtectedCameraView';
import { ScannerBottomBar } from '../src/components/ScannerBottomBar';
import { detectBlur, BlurDetectionResult } from '../src/utils/blurDetection';
import { Ionicons } from '@expo/vector-icons';

const FRAME_INTERVAL_MS     = 1200;  // reduced from 500ms — less flicker, still responsive
const CAPTURE_COOLDOWN_MS   = 1500;
const STABILITY_LOCK_FRAMES = 3;
const STABILITY_LOST_FRAMES = 5;
const ENABLE_LIVE_DETECTION = true;

type FilterMode = 'original' | 'enhanced' | 'bw' | 'high_contrast';

const FILTERS: { id: FilterMode; label: string; icon: string }[] = [
  { id: 'original',      label: 'Original',      icon: 'image-outline' },
  { id: 'enhanced',      label: 'Enhanced',      icon: 'sunny-outline' },
  { id: 'bw',            label: 'B&W',            icon: 'contrast-outline' },
  { id: 'high_contrast', label: 'High Contrast',  icon: 'options-outline' },
];

interface PendingCapture {
  uri: string;
  blur: BlurDetectionResult;
  quad: Quadrilateral | null;
  dims: any;
}

export default function ScannerScreen() {
  const router    = useRouter();
  const insets    = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const isMounted = useRef(true);
  const [permission, requestPermission] = useCameraPermissions();

  // ── Store ──────────────────────────────────────────────────────────────────
  const currentPhase        = useScanStore(s => s.currentPhase);
  const currentStudentIndex = useScanStore(s => s.currentStudentIndex);
  const autoCaptureEnabled  = useScanStore(s => s.autoCaptureEnabled);
  const flashMode           = useScanStore(s => s.flashMode);
  const pendingRetake       = useScanStore(s => s.pendingRetake);

  const currentPages = useScanStore(useShallow(state => {
    if (!state.currentSession) return [];
    if (state.currentPhase === 'question_paper') return state.currentSession.question_paper?.pages ?? [];
    if (state.currentPhase === 'model_answer')   return state.currentSession.model_answer?.pages ?? [];
    return state.currentSession.students[state.currentStudentIndex]?.pages ?? [];
  }));

  const studentLabel = useScanStore(s =>
    s.currentSession?.students[s.currentStudentIndex]?.label ?? `Student #${s.currentStudentIndex + 1}`
  );

  const studentsCount = useScanStore(s =>
    s.currentSession?.students.filter(st => st.page_count > 0).length ?? 0
  );

  const {
    addPage,
    silentNextStudent,
    undoLastPage,
    saveSession,
    clearRetake,
    setAutoCaptureEnabled,
    setFlashMode,
  } = useScanStore(useShallow(s => ({
    addPage:               s.addPage,
    silentNextStudent:     s.silentNextStudent,
    undoLastPage:          s.undoLastPage,
    saveSession:           s.saveSession,
    clearRetake:           s.clearRetake,
    setAutoCaptureEnabled: s.setAutoCaptureEnabled,
    setFlashMode:          s.setFlashMode,
  })));

  // ── Refs ───────────────────────────────────────────────────────────────────
  const isCapturingRef    = useRef(false);
  const cooldownRef       = useRef(false);
  const isPausedRef       = useRef(false);
  const normalizingRef    = useRef(false);
  const isProcessingFrame = useRef(false);
  const frameLoopRef      = useRef<any>(null);
  const cooldownTimerRef  = useRef<any>(null);
  const lastQuadRef       = useRef<Quadrilateral | null>(null);
  const cvResultRef       = useRef<CVProcessingResult | null>(null);
  const autoCaptureRef    = useRef(autoCaptureEnabled);
  const stableCountRef    = useRef(0);
  const lostCountRef      = useRef(0);
  const isLockedRef       = useRef(false);
  // KEY FIX: stable ref to addPage — frame loop closure never goes stale
  const addPageRef        = useRef(addPage);

  // ── React state ────────────────────────────────────────────────────────────
  const [isCameraReady, setIsCameraReady]         = useState(false);
  const [isPaused, setIsPaused]                   = useState(false);
  const [isCapturing, setIsCapturing]             = useState(false);
  const [liveScanStatus, setLiveScanStatus]       = useState<LiveScanStatus>('searching');
  const [cvResult, setCvResult]                   = useState<CVProcessingResult | null>(null);
  const [stabilityProgress, setStabilityProgress] = useState(0);
  const [filterPicker, setFilterPicker]           = useState<{ visible: boolean; pending: PendingCapture | null }>({ visible: false, pending: null });
  const [liveFlashMode, setLiveFlashMode]         = useState<'off' | 'on' | 'auto'>('off');

  const recentPages = currentPages.slice(-8);

  // Keep refs in sync
  useEffect(() => { autoCaptureRef.current = autoCaptureEnabled; }, [autoCaptureEnabled]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { cvResultRef.current = cvResult; }, [cvResult]);
  useEffect(() => { addPageRef.current = addPage; }, [addPage]);

  // Fallback: If onCameraReady doesn't fire (known expo-camera bug on quick remounts),
  // force isCameraReady to true after a safe timeout if the ref is populated.
  useEffect(() => {
    if (isCameraReady) return;
    const timer = setTimeout(() => {
      if (cameraRef.current) {
        if (__DEV__) {
          console.log('[Camera] Fallback: forcing isCameraReady to true');
        }
        setIsCameraReady(true);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [isCameraReady]);

  useEffect(() => {
    ScreenOrientation.unlockAsync();
    return () => {
      isMounted.current = false;
      clearTimeout(cooldownTimerRef.current);
      clearTimeout(frameLoopRef.current);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  const onCameraReady = useCallback(() => setIsCameraReady(true), []);

  // ── Frame loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ENABLE_LIVE_DETECTION || !isCameraReady || !permission?.granted) return;

    const processFrame = async () => {
      if (isProcessingFrame.current || !cameraRef.current || isPausedRef.current || isCapturingRef.current) {
        frameLoopRef.current = setTimeout(processFrame, 1000);
        return;
      }
      try {
        isProcessingFrame.current = true;
        // FIX: quality 0.1 destroyed paper/desk edge contrast → Canny found only noise.
        // At quality 0.4 the boundary survives. 640px gives better edge continuity.
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.4, skipProcessing: true, base64: false });
        if (!photo?.uri) return;

        const resized = await ImageManipulator.manipulateAsync(photo.uri, [{ resize: { width: 640 } }], { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.7 });
        if (!resized?.base64) return;

        const result = await detectDocumentInFrame(resized.base64, resized.width, resized.height);

        if (result.confidence >= 0.25) {
          stableCountRef.current = Math.min(stableCountRef.current + 1, 10);
          lostCountRef.current = 0;
          if (stableCountRef.current >= STABILITY_LOCK_FRAMES) isLockedRef.current = true;
        } else if (result.confidence <= 0.35) {
          lostCountRef.current++;
          stableCountRef.current = 0;
          if (lostCountRef.current >= STABILITY_LOST_FRAMES) isLockedRef.current = false;
        }

        if (__DEV__) {
          console.log(`[CV PROCESS] confidence=${result.confidence.toFixed(2)}, isStable=${result.isStable}, stableCount=${stableCountRef.current}, isLocked=${isLockedRef.current}`);
        }

        lastQuadRef.current = result.quadrilateral;
        setCvResult(result);
        setStabilityProgress(isLockedRef.current ? Math.min(stableCountRef.current / 5, 1) : 0);

        if (!isCapturingRef.current) {
          setLiveScanStatus(isLockedRef.current && result.isStable ? 'locked' : 'searching');
        }

        if (autoCaptureRef.current && isLockedRef.current && result.isStable && !cooldownRef.current && !isCapturingRef.current) {
          triggerCapture();
        }

        try { new File(photo.uri).delete(); } catch (_) {}
      } catch (_) {
      } finally {
        isProcessingFrame.current = false;
        frameLoopRef.current = setTimeout(processFrame, FRAME_INTERVAL_MS);
      }
    };

    frameLoopRef.current = setTimeout(processFrame, 800);
    return () => clearTimeout(frameLoopRef.current);
  }, [isCameraReady, permission?.granted]);

  // ── Capture ────────────────────────────────────────────────────────────────
  const triggerCapture = useCallback(async () => {
    if (!isMounted.current || isCapturingRef.current || cooldownRef.current || !cameraRef.current) return;
    isCapturingRef.current = true;
    cooldownRef.current    = true;
    setIsCapturing(true);
    setLiveScanStatus('capturing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // 1. Temporarily activate flash if enabled in the store
      const activeFlash = useScanStore.getState().flashMode;
      if (activeFlash && activeFlash !== 'off') {
        setLiveFlashMode(activeFlash);
        // Wait for React state to render and native camera to warm up flash
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true, shutterSound: false });
      if (!photo?.uri) throw new Error('No URI');

      const blur = await detectBlur(photo.uri);
      if (blur.level === 'very_blurry') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }

      const pending: PendingCapture = {
        uri:  photo.uri,
        blur,
        quad: lastQuadRef.current,
        dims: cvResultRef.current?.dimensions ?? { width: 480, height: 640 },
      };

      if (autoCaptureRef.current) {
        await commitCapture(pending, 'original');
      } else {
        setFilterPicker({ visible: true, pending });
      }
    } catch (e) {
      console.warn('Capture error', e);
    } finally {
      isCapturingRef.current = false;
      setIsCapturing(false);
      setLiveFlashMode('off'); // 2. Always turn flash back off to prevent frame loop strobe light flickering
      startCooldown();
    }
  }, []);

  const handleManualCapture = useCallback(() => triggerCapture(), [triggerCapture]);

  // ── Commit with filter ─────────────────────────────────────────────────────
  const commitCapture = useCallback(async (pending: PendingCapture, filter: FilterMode) => {
    if (normalizingRef.current) return;
    normalizingRef.current = true;
    setFilterPicker({ visible: false, pending: null });

    try {
      let finalUri = pending.uri;

      // Step 1: Perspective correction if we have a quad
      if (pending.quad?.topLeft) {
        try {
          const norm = await normalizeCapturedDocument(pending.uri, pending.quad, pending.dims);
          finalUri = norm.uri;
        } catch (_) {}
      }

      // Step 2: Resize
      if (finalUri === pending.uri) {
        const resized = await ImageManipulator.manipulateAsync(
          finalUri,
          [{ resize: { width: 1200 } }],
          { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG }
        );
        finalUri = resized.uri;
      }

      // Step 3: Convert to grayscale (B&W) using OpenCV
      // All answer paper / marksheet captures are stored as grayscale.
      // This reduces file size and improves OCR. Falls back to color on error.
      finalUri = await convertToGrayscale(finalUri);

      // Step 4: Copy to permanent document storage
      const filename = `scanned_${Date.now()}.jpg`;
      const dest = new File(Paths.document, filename);
      new File(finalUri).copy(dest);

      // Step 5: Poll for file existence (max 500ms)
      let verified = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        if (dest.exists) { verified = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!verified) {
        console.warn('[commitCapture] File copy timed out:', dest.uri);
        return;
      }

      // Step 6: Commit to store via ref (never stale)
      addPageRef.current({
        id:              generateUUID(),
        ui_id:           '',
        page_number:     0,
        file_path:       dest.uri,
        file_size:       dest.size || 0,
        is_blurry:       pending.blur.isBlurry,
        sharpness_score: pending.blur.sharpnessScore,
        filter_mode:     'bw',
        captured_at:     new Date().toISOString(),
      });

      setLiveScanStatus('saved');
      setTimeout(() => { if (isMounted.current) setLiveScanStatus('searching'); }, 1500);

    } catch (e) {
      console.warn('[commitCapture] error:', e);
    } finally {
      normalizingRef.current = false;
    }
  }, []);

  const startCooldown = () => {
    cooldownTimerRef.current = setTimeout(() => { if (isMounted.current) cooldownRef.current = false; }, CAPTURE_COOLDOWN_MS);
  };

  const handleTogglePause = useCallback(() => {
    setIsPaused(prev => { isPausedRef.current = !prev; return !prev; });
  }, []);

  const handleNextStudent = useCallback(() => {
    silentNextStudent();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [silentNextStudent]);

  const phaseLabel = () => {
    if (pendingRetake) return `Retake · ${studentLabel}`;
    if (currentPhase === 'question_paper') return 'Question Paper';
    if (currentPhase === 'model_answer')   return 'Model Answer';
    return studentLabel;
  };

  if (!permission?.granted) {
    return (
      <View style={styles.permBox}>
        <Text style={styles.permText}>Camera permission needed</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScannerHeader
        phaseTitle={phaseLabel()}
        pageCount={currentPages.length}
        studentsCount={studentsCount}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        flashMode={flashMode}
        onToggleFlash={() => setFlashMode(flashMode === 'on' ? 'off' : 'on')}
        autoCaptureEnabled={autoCaptureEnabled}
        onToggleAutoCapture={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
      />

      {/* KEY FIX: flex:1 here means camera fills ALL remaining space — no hardcoded height */}
      <View style={styles.cameraWrapper}>
        <ProtectedCameraView
          cameraRef={cameraRef}
          onCameraReady={onCameraReady}
          isCameraReady={isCameraReady}
          isPaused={isPaused}
          flashMode={liveFlashMode}
          style={StyleSheet.absoluteFill}
        />
        {ENABLE_LIVE_DETECTION && <DocumentContourOverlay quadrilateral={cvResult?.quadrilateral ?? null} />}

        {pendingRetake && (
          <View style={styles.retakeBanner}>
            <Text style={styles.retakeText}>Retaking page {pendingRetake.originalPageNumber} — hold steady over the paper</Text>
            <TouchableOpacity onPress={clearRetake}><Text style={styles.retakeCancel}>Cancel</Text></TouchableOpacity>
          </View>
        )}

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: liveScanStatus === 'locked' ? '#4CAF50' : liveScanStatus === 'capturing' ? '#FF9800' : liveScanStatus === 'saved' ? '#2196F3' : '#9E9E9E' }]} />
          <Text style={styles.statusText}>{liveScanStatus === 'locked' ? 'Ready' : liveScanStatus === 'capturing' ? 'Capturing…' : liveScanStatus === 'saved' ? 'Saved ✓' : 'Searching…'}</Text>
        </View>
      </View>

      {/* Thumbnail strip — like WhatsApp camera roll, newest right */}
      {recentPages.length > 0 && (
        <View style={styles.thumbStrip}>
          <FlatList
            data={[...recentPages].reverse()}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ paddingHorizontal: 8, gap: 6, alignItems: 'center' }}
            renderItem={({ item }) => (
              <View style={styles.thumbItem}>
                <Image source={{ uri: item.file_path }} style={styles.thumbImage} contentFit="cover" />
                {item.is_blurry && <View style={styles.blurDot} />}
              </View>
            )}
          />
        </View>
      )}

      <ScannerBottomBar
        currentPhase={currentPhase}
        isPaused={isPaused}
        isCapturing={isCapturing}
        isCameraReady={isCameraReady}
        currentPagesCount={currentPages.length}
        autoCaptureEnabled={autoCaptureEnabled}
        stabilityProgress={stabilityProgress}
        onTogglePause={handleTogglePause}
        onManualCapture={handleManualCapture}
        onNextStudent={handleNextStudent}
        onUndo={undoLastPage}
        onFinishPhase={() => {}}
        onFinishSession={() => { saveSession(); router.replace('/review'); }}
      />

      {/* Filter picker — manual capture only */}
      <Modal
        visible={filterPicker.visible}
        transparent
        animationType="slide"
        onRequestClose={() => filterPicker.pending && commitCapture(filterPicker.pending, 'original')}
      >
        <Pressable style={styles.filterBackdrop} onPress={() => filterPicker.pending && commitCapture(filterPicker.pending, 'original')}>
          <View style={[styles.filterSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.filterTitle}>Choose Filter</Text>
            {filterPicker.pending && (
              <Image source={{ uri: filterPicker.pending.uri }} style={styles.filterPreview} contentFit="contain" />
            )}
            <View style={styles.filterRow}>
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.filterBtn}
                  onPress={() => filterPicker.pending && commitCapture(filterPicker.pending, f.id)}
                >
                  <Ionicons name={f.icon as any} size={26} color={COLORS.primary} />
                  <Text style={styles.filterLabel}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#000' },
  cameraWrapper:  { flex: 1, overflow: 'hidden' },
  permBox:        { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  permText:       { color: '#fff', fontSize: 16, marginBottom: 16 },
  permBtn:        { backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  permBtnText:    { color: '#fff', fontWeight: '600' },
  retakeBanner:   { position: 'absolute', top: 12, left: 16, right: 16, backgroundColor: 'rgba(239,159,39,0.93)', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 },
  retakeText:     { color: '#fff', fontSize: 13, flex: 1, lineHeight: 18 },
  retakeCancel:   { color: '#fff', fontWeight: '700', paddingLeft: 12 },
  statusPill:     { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  statusText:     { color: '#fff', fontSize: 12, fontWeight: '600' },
  thumbStrip:     { height: 72, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center' },
  thumbItem:      { width: 52, height: 60, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  thumbImage:     { width: '100%', height: '100%' },
  blurDot:        { position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E24B4A' },
  filterBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  filterSheet:    { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  filterTitle:    { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  filterPreview:  { width: '100%', height: 180, borderRadius: 10, marginBottom: 16 },
  filterRow:      { flexDirection: 'row', justifyContent: 'space-around' },
  filterBtn:      { alignItems: 'center', gap: 6, padding: 10 },
  filterLabel:    { color: '#fff', fontSize: 12, fontWeight: '600' },
});
