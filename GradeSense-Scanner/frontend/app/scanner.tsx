// app/scanner.tsx
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
import { ScannerHeader } from '../src/components/ScannerHeader';
import { ProtectedCameraView } from '../src/components/ProtectedCameraView';
import { ScannerBottomBar } from '../src/components/ScannerBottomBar';
import { detectBlur, BlurDetectionResult } from '../src/utils/blurDetection';
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ────────────────────────────────────────────────────────────────
const CAPTURE_COOLDOWN_MS = 2500;
const ENABLE_LIVE_DETECTION = false;

// ─── Scanner State Machine ────────────────────────────────────────────────────
type ScannerPhase =
  | 'SEARCHING'
  | 'DETECTED'
  | 'STABILIZING'
  | 'READY'
  | 'CAPTURING'
  | 'COOLDOWN';

type FilterMode = 'original' | 'enhanced' | 'bw' | 'high_contrast';

const FILTERS: { id: FilterMode; label: string; icon: string }[] = [
  { id: 'original', label: 'Original', icon: 'image-outline' },
  { id: 'enhanced', label: 'Enhanced', icon: 'sunny-outline' },
  { id: 'bw', label: 'B&W', icon: 'contrast-outline' },
  { id: 'high_contrast', label: 'High Contrast', icon: 'options-outline' },
];

interface PendingCapture {
  uri: string;
  blur: BlurDetectionResult;
  quad: Quadrilateral | null;
  dims: { width: number; height: number };
}

function phaseToLiveStatus(phase: ScannerPhase): LiveScanStatus {
  switch (phase) {
    case 'SEARCHING': return 'searching';
    case 'CAPTURING': return 'capturing';
    case 'COOLDOWN': return 'saved';
    default: return 'searching';
  }
}

export default function ScannerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const isMounted = useRef(true);
  const [permission, requestPermission] = useCameraPermissions();

  // ── Store ──────────────────────────────────────────────────────────────────
  const currentPhase = useScanStore(s => s.currentPhase);
  const currentStudentIndex = useScanStore(s => s.currentStudentIndex);
  const autoCaptureEnabled = useScanStore(s => s.autoCaptureEnabled);
  const flashMode = useScanStore(s => s.flashMode);
  const pendingRetake = useScanStore(s => s.pendingRetake);

  const currentPages = useScanStore(useShallow(state => {
    if (!state.currentSession) return [];
    if (state.currentPhase === 'question_paper') return state.currentSession.question_paper?.pages ?? [];
    if (state.currentPhase === 'model_answer') return state.currentSession.model_answer?.pages ?? [];
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
    addPage: s.addPage,
    silentNextStudent: s.silentNextStudent,
    undoLastPage: s.undoLastPage,
    saveSession: s.saveSession,
    clearRetake: s.clearRetake,
    setAutoCaptureEnabled: s.setAutoCaptureEnabled,
    setFlashMode: s.setFlashMode,
  })));

  // ── Refs ───────────────────────────────────────────────────────────────────
  const normalizingRef = useRef(false);
  const lastQuadRef = useRef<Quadrilateral | null>(null);
  const cvResultRef = useRef<CVProcessingResult | null>(null);
  const autoCaptureRef = useRef(autoCaptureEnabled);
  const addPageRef = useRef(addPage);
  const isPausedRef = useRef(false);

  // State machine refs
  const scannerPhaseRef = useRef<ScannerPhase>('SEARCHING');
  const cooldownEndRef = useRef(0);

  // ── React state ────────────────────────────────────────────────────────────
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [liveScanStatus, setLiveScanStatus] = useState<LiveScanStatus>('searching');
  const [stabilityProgress, setStabilityProgress] = useState(0);
  const [liveFlashMode, setLiveFlashMode] = useState<'off' | 'on' | 'auto'>('off');
  const [filterPicker, setFilterPicker] = useState<{
    visible: boolean;
    pending: PendingCapture | null;
  }>({ visible: false, pending: null });

  // NOTE: cvResult state is REMOVED. The frame loop now writes to:
  //   - cvResultRef  (for triggerCapture to read lastQuad/dims — no render)
  //   - overlayState (for DocumentContourOverlay — gated, only on real changes)
  // This eliminates the render cascade that fired on every single CV frame.

  const recentPages = currentPages.slice(-8);

  useEffect(() => { autoCaptureRef.current = autoCaptureEnabled; }, [autoCaptureEnabled]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { addPageRef.current = addPage; }, [addPage]);

  // Camera ready fallback
  useEffect(() => {
    if (isCameraReady) return;
    const t = setTimeout(() => {
      if (cameraRef.current) setIsCameraReady(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [isCameraReady]);

  useEffect(() => {
    ScreenOrientation.unlockAsync();
    return () => {
      isMounted.current = false;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  const onCameraReady = useCallback(() => setIsCameraReady(true), []);

  const transitionTo = useCallback((phase: ScannerPhase) => {
    if (scannerPhaseRef.current === phase) return;
    scannerPhaseRef.current = phase;
    setLiveScanStatus(phaseToLiveStatus(phase));
    if (phase === 'CAPTURING') setIsCapturing(true);
    else if (phase === 'COOLDOWN' || phase === 'SEARCHING') setIsCapturing(false);
  }, []);

  // ── triggerCapture ─────────────────────────────────────────────────────────
  const triggerCapture = useCallback(async () => {
    if (!isMounted.current || !cameraRef.current) return;
    if (scannerPhaseRef.current === 'CAPTURING') return;

    transitionTo('CAPTURING');

    try {
      const activeFlash = useScanStore.getState().flashMode;
      if (activeFlash !== 'off') {
        setLiveFlashMode(activeFlash);
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.88,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.uri) throw new Error('No photo URI');

      // Haptic fires ONCE here — at the exact moment of capture
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const blur = await detectBlur(photo.uri);
      if (blur.level === 'very_blurry') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }

      const pending: PendingCapture = {
        uri: photo.uri,
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
      console.warn('[triggerCapture] error:', e);
    } finally {
      setLiveFlashMode('off');

      // Transition logic removed for live detection.
      transitionTo('COOLDOWN');
      setTimeout(() => transitionTo('SEARCHING'), CAPTURE_COOLDOWN_MS);
    }
  }, [transitionTo]);

  // ── commitCapture ──────────────────────────────────────────────────────────
  const commitCapture = useCallback(async (
    pending: PendingCapture,
    filter: FilterMode,
  ) => {
    if (normalizingRef.current) return;
    normalizingRef.current = true;
    setFilterPicker({ visible: false, pending: null });

    try {
      let finalUri = pending.uri;

      // Step 1: Perspective correction with scaled coordinates
      if (pending.quad?.topLeft && pending.dims) {
        try {
          const fullRes = await ImageManipulator.manipulateAsync(
            pending.uri,
            [],
            { format: ImageManipulator.SaveFormat.JPEG },
          );
          const scaleX = fullRes.width / pending.dims.width;
          const scaleY = fullRes.height / pending.dims.height;

          const scaledQuad: Quadrilateral = {
            topLeft: { x: pending.quad.topLeft.x * scaleX, y: pending.quad.topLeft.y * scaleY },
            topRight: { x: pending.quad.topRight.x * scaleX, y: pending.quad.topRight.y * scaleY },
            bottomRight: { x: pending.quad.bottomRight.x * scaleX, y: pending.quad.bottomRight.y * scaleY },
            bottomLeft: { x: pending.quad.bottomLeft.x * scaleX, y: pending.quad.bottomLeft.y * scaleY },
          };

          const norm = await normalizeCapturedDocument(
            pending.uri,
            scaledQuad,
            { width: fullRes.width, height: fullRes.height },
          );
          finalUri = norm.uri;
        } catch (e) {
          console.warn('[commitCapture] perspective correction failed:', e);
        }
      }

      // Step 2: Resize if perspective correction didn't run
      if (finalUri === pending.uri) {
        const resized = await ImageManipulator.manipulateAsync(
          finalUri,
          [{ resize: { width: 1200 } }],
          { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
        );
        finalUri = resized.uri;
      }

      // Step 3: Grayscale via OpenCV
      finalUri = await convertToGrayscale(finalUri);

      // Step 4: Copy to permanent storage
      const filename = `scanned_${Date.now()}.jpg`;
      const dest = new File(Paths.document, filename);
      new File(finalUri).copy(dest);

      // Step 5: Poll for existence
      let verified = false;
      for (let i = 0; i < 10; i++) {
        if (dest.exists) { verified = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }
      if (!verified) {
        console.warn('[commitCapture] file not found after copy');
        return;
      }

      // Step 6: Persist
      addPageRef.current({
        id: generateUUID(),
        ui_id: '',
        page_number: 0,
        file_path: dest.uri,
        file_size: dest.size || 0,
        is_blurry: pending.blur.isBlurry,
        sharpness_score: pending.blur.sharpnessScore,
        captured_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[commitCapture] error:', e);
    } finally {
      normalizingRef.current = false;
    }
  }, []);

  // ── UI handlers ────────────────────────────────────────────────────────────
  const handleManualCapture = useCallback(() => {
    if (
      scannerPhaseRef.current === 'CAPTURING' ||
      scannerPhaseRef.current === 'COOLDOWN'
    ) return;
    triggerCapture();
  }, [triggerCapture]);

  const handleTogglePause = useCallback(() => {
    setIsPaused(prev => {
      isPausedRef.current = !prev;
      return !prev;
    });
  }, []);

  const handleNextStudent = useCallback(() => {
    silentNextStudent();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [silentNextStudent]);

  const phaseLabel = () => {
    if (pendingRetake) return `Retake · ${studentLabel}`;
    if (currentPhase === 'question_paper') return 'Question Paper';
    if (currentPhase === 'model_answer') return 'Model Answer';
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
        studentsWithPagesCount={studentsCount}
        showStudentCount={studentsCount > 0}
        pageMode="single"
        isLandscape={false}
        onBack={() => router.back()}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
      />

      <View style={styles.cameraWrapper}>
        <ProtectedCameraView
          cameraRef={cameraRef}
          onCameraReady={onCameraReady}
          isCameraReady={isCameraReady}
          isPaused={isPaused}
          flashMode={liveFlashMode}
          style={StyleSheet.absoluteFill}
        />

        {pendingRetake && (
          <View style={styles.retakeBanner}>
            <Text style={styles.retakeText}>
              Retaking page {pendingRetake.originalPageNumber} — hold steady
            </Text>
            <TouchableOpacity onPress={clearRetake}>
              <Text style={styles.retakeCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.statusPill}>
          <View style={[
            styles.statusDot,
            {
              backgroundColor:
                liveScanStatus === 'holding' ? '#4CAF50' :
                  liveScanStatus === 'capturing' ? '#FF9800' :
                    liveScanStatus === 'saved' ? '#2196F3' : '#9E9E9E',
            },
          ]} />
          <Text style={styles.statusText}>
            {liveScanStatus === 'holding' ? 'Ready' :
              liveScanStatus === 'capturing' ? 'Capturing…' :
                liveScanStatus === 'saved' ? 'Saved ✓ — move to next page' :
                  'Searching…'}
          </Text>
        </View>
      </View>

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
                <Image
                  source={{ uri: item.file_path }}
                  style={styles.thumbImage}
                  contentFit="cover"
                />
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
        onFinishPhase={() => { }}
        onFinishSession={() => {
          saveSession();
          router.replace('/review');
        }}
      />

      <Modal
        visible={filterPicker.visible}
        transparent
        animationType="slide"
        onRequestClose={() =>
          filterPicker.pending && commitCapture(filterPicker.pending, 'original')
        }
      >
        <Pressable
          style={styles.filterBackdrop}
          onPress={() =>
            filterPicker.pending && commitCapture(filterPicker.pending, 'original')
          }
        >
          <View style={[styles.filterSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.filterTitle}>Choose Filter</Text>
            {filterPicker.pending && (
              <Image
                source={{ uri: filterPicker.pending.uri }}
                style={styles.filterPreview}
                contentFit="contain"
              />
            )}
            <View style={styles.filterRow}>
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.filterBtn}
                  onPress={() =>
                    filterPicker.pending && commitCapture(filterPicker.pending, f.id)
                  }
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
  root: { flex: 1, backgroundColor: '#000' },
  cameraWrapper: { flex: 1, overflow: 'hidden' },
  permBox: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  permText: { color: '#fff', fontSize: 16, marginBottom: 16 },
  permBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  permBtnText: { color: '#fff', fontWeight: '600' },
  retakeBanner: { position: 'absolute', top: 12, left: 16, right: 16, backgroundColor: 'rgba(239,159,39,0.93)', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 },
  retakeText: { color: '#fff', fontSize: 13, flex: 1, lineHeight: 18 },
  retakeCancel: { color: '#fff', fontWeight: '700', paddingLeft: 12 },
  statusPill: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  thumbStrip: { height: 72, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center' },
  thumbItem: { width: 52, height: 60, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  thumbImage: { width: '100%', height: '100%' },
  blurDot: { position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E24B4A' },
  filterBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  filterSheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  filterTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  filterPreview: { width: '100%', height: 180, borderRadius: 10, marginBottom: 16 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-around' },
  filterBtn: { alignItems: 'center', gap: 6, padding: 10 },
  filterLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
// added again