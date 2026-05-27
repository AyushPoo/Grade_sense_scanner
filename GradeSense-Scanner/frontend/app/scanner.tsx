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
import { detectDocumentInFrame, convertToGrayscale, FilterMode, applyFilter, resetScannerState } from '../src/utils/cvProcessor';
import { normalizeCapturedDocument } from '../src/utils/documentNormalizer';
import { generateUUID, useScanStore } from '../src/store/scanStore';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import { File, Paths } from 'expo-file-system';
import { AppState, AppStateStatus } from 'react-native';
import { COLORS } from '../src/config';
import { useShallow } from 'zustand/react/shallow';
import { CVProcessingResult, Quadrilateral } from '../src/utils/cvProcessor';
import { LiveScanStatus } from '../src/components/StatusIndicator';
import { ScannerHeader } from '../src/components/ScannerHeader';
import { ProtectedCameraView } from '../src/components/ProtectedCameraView';
import { ScannerBottomBar } from '../src/components/ScannerBottomBar';
import { detectBlur, BlurDetectionResult } from '../src/utils/blurDetection';
import { Ionicons } from '@expo/vector-icons';
import { useMotionStability } from '../src/hooks/useMotionStability';

// ─── Constants ────────────────────────────────────────────────────────────────
const CAPTURE_COOLDOWN_MS = 2500;
const ENABLE_LIVE_DETECTION = false;

// ─── Motion detection parameters ─────────────────────────────────────────────
//
// TUNING GUIDE:
//   MOTION_THRESHOLD is in delta g-units (change between readings, NOT raw magnitude).
//   Raw magnitude always ~1.0 due to gravity — delta cancels it out.
//   Still phone delta: ~0.000–0.015
//   Hand tremor:       ~0.020–0.060
//   Slow movement:     ~0.060–0.150
//
//   0.02 = very strict (tripod stillness)
//   0.04 = recommended (comfortable hand-held use)  ← default
//   0.08 = relaxed (mild movement still triggers)
//
//   MOTION_STABILITY_WAIT_TIME: how long phone must stay still before capture fires
//   Increase (4000–5000ms) for more accuracy / reduce false triggers
//   Decrease (2000–2500ms) for faster workflow
//
//   MOTION_UPDATE_INTERVAL: how often to poll accelerometer (ms)
//   Lower = smoother delta, faster response. 100ms recommended.
//   Do not go below 50ms (battery drain, marginal benefit).
//
const MOTION_STABILITY_WAIT_TIME = 3500;   // ms — wait after stable detected
const MOTION_THRESHOLD = 0.04;   // delta g-units (was 0.5 raw magnitude — wrong)
const MOTION_SAMPLE_COUNT = 5;      // consecutive stable readings required
const MOTION_UPDATE_INTERVAL = 100;    // ms — poll frequency (was 250, too slow for delta)
const AUTO_CAPTURE_CONFIDENCE_THRESHOLD = 0.50;

// ─── Scanner State Machine ────────────────────────────────────────────────────
type ScannerPhase =
    | 'SEARCHING'
    | 'DETECTED'
    | 'STABILIZING'
    | 'READY'
    | 'CAPTURING'
    | 'COOLDOWN';

// FilterMode is imported from cvProcessor: 'original' | 'grayscale' | 'high_contrast' | 'adaptive_threshold'

interface PendingCapture {
    uri: string;
    blur: BlurDetectionResult;
    quad: Quadrilateral | null;
    dims: { width: number; height: number };
    rawDims: { width: number; height: number };
}

function phaseToLiveStatus(phase: ScannerPhase): LiveScanStatus {
    switch (phase) {
        case 'SEARCHING': return 'searching';
        case 'STABILIZING': return 'searching';
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

    const scannerPhaseRef = useRef<ScannerPhase>('SEARCHING');
    const cooldownEndRef = useRef(0);

    // ── React state ────────────────────────────────────────────────────────────
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [liveScanStatus, setLiveScanStatus] = useState<LiveScanStatus>('searching');
    const [stabilityProgress, setStabilityProgress] = useState(0);
    const [liveFlashMode, setLiveFlashMode] = useState<'off' | 'on' | 'auto'>('off');
    const [isStabilizing, setIsStabilizing] = useState(false);
    // Filter picker removed in favor of review screen palette.

    const [showShutterFlash, setShowShutterFlash] = useState(false);

    // Toggle flash mode helper
    const handleToggleFlash = useCallback(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const nextMode = flashMode === 'auto' ? 'on' : flashMode === 'on' ? 'off' : 'auto';
        setFlashMode(nextMode);
    }, [flashMode, setFlashMode]);

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
        resetScannerState();
        ScreenOrientation.unlockAsync();
        return () => {
            isMounted.current = false;
            resetScannerState();
            ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        };
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (nextAppState.match(/inactive|background/)) {
                resetScannerState();
            }
        });
        return () => subscription.remove();
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
    // Called by both manual button tap and motion detection hook
    const triggerCapture = useCallback(async () => {
        if (!isMounted.current || !cameraRef.current) return;
        if (scannerPhaseRef.current === 'CAPTURING') return;

        transitionTo('CAPTURING');

        try {
            // Visual shutter flash effect
            setShowShutterFlash(true);
            setTimeout(() => {
                if (isMounted.current) setShowShutterFlash(false);
            }, 100);

            const activeFlash = useScanStore.getState().flashMode;
            if (activeFlash !== 'off') {
                setLiveFlashMode(activeFlash);
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            const photo = await cameraRef.current.takePictureAsync({
                quality: 0.88,
                shutterSound: false,
            });
            if (!photo?.uri) throw new Error('No photo URI');

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
                rawDims: { width: photo.width, height: photo.height },
            };

            // Commit with grayscale as the default OCR-optimised filter.
            await commitCapture(pending, 'grayscale');
        } catch (e) {
            console.warn('[triggerCapture] error:', e);
        } finally {
            setLiveFlashMode('off');
            transitionTo('COOLDOWN');
            resetScannerState();
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

        try {
            let finalUri = pending.uri;

            // ── PHASE 1: Create EXIF-Resolved Canonical Image ──────────────
            // ImageManipulator applies EXIF rotation, producing a physically
            // upright bitmap. OpenCV.imread ignores EXIF, so we must feed it
            // this pre-rotated image to keep coordinate spaces unified.
            const canonical = await ImageManipulator.manipulateAsync(
                pending.uri,
                [{ rotate: 0 }],
                { compress: 0.98, format: ImageManipulator.SaveFormat.JPEG }
            );
            const canonicalUri = canonical.uri;
            const canonicalDims = { width: canonical.width, height: canonical.height };

            if (__DEV__) {
                console.log(`[EXIF-AUDIT] canonicalDims=${canonical.width}x${canonical.height} rawDims=${pending.rawDims.width}x${pending.rawDims.height}`);
            }

            // Step 1: Post-Capture Auto-Crop Detection
            let detectionQuad = null;
            let detectionDims = pending.dims;
            let finalScaledQuad = null;

            // Save raw un-warped camera image
            const rawFilename = `raw_${Date.now()}.jpg`;
            const destRaw = new File(Paths.document, rawFilename);
            new File(pending.uri).copy(destRaw);
            let rawVerified = false;
            for (let i = 0; i < 10; i++) {
                if (destRaw.exists) { rawVerified = true; break; }
                await new Promise(r => setTimeout(r, 50));
            }

            try {
                if (useScanStore.getState().autoCropEnabled) {
                    // Downscale the EXIF-resolved canonical image (NOT raw sensor image)
                    const downscaled = await ImageManipulator.manipulateAsync(
                        canonicalUri,
                        [{ resize: { width: 640 } }],
                        { base64: false, format: ImageManipulator.SaveFormat.JPEG, compress: 0.5 }
                    );

                    if (__DEV__) {
                        console.log(`[EXIF-AUDIT] detectionDims=${downscaled.width}x${downscaled.height}`);
                    }

                    if (downscaled.uri) {
                        const cvResult = await detectDocumentInFrame(
                            downscaled.uri,
                            downscaled.width,
                            downscaled.height
                        );
                        
                        console.log(`[DEBUG-AUTOCROP] cvResult returned:`, JSON.stringify({
                            isDetected: cvResult?.isDocumentDetected,
                            hasQuad: !!cvResult?.quadrilateral,
                            sharpness: cvResult?.sharpnessScore,
                            areaScore: cvResult?.areaScore,
                            confidence: cvResult?.confidence
                        }));

                        if (cvResult && cvResult.quadrilateral) {
                            detectionQuad = cvResult.quadrilateral;
                            detectionDims = { width: downscaled.width, height: downscaled.height };
                            console.log('[commitCapture] Post-capture detection SUCCESS');
                        } else {
                            console.log('[commitCapture] Post-capture detection failed to find document. Falling back to original image.');
                        }

                        // CLEANUP: delete temporary downscaled file
                        try {
                            new File(downscaled.uri).delete();
                        } catch (_) {}
                    }
                } else {
                    console.log('[commitCapture] Auto-crop disabled. Skipping post-capture detection.');
                }
            } catch (detectErr) {
                console.warn('[commitCapture] post-capture detection error:', detectErr);
            }

            // Step 2: Perspective correction with scaled coordinates
            // Both canonicalDims and detectionDims are now in the same EXIF-resolved
            // upright coordinate space, so scaleX/scaleY are mathematically correct.
            if (detectionQuad?.topLeft && detectionDims) {
                try {
                    // ── PHASE 6: Orientation mismatch guard ──────────────────
                    const canonicalIsPortrait = canonicalDims.width < canonicalDims.height;
                    const detectionIsPortrait = detectionDims.width < detectionDims.height;
                    if (canonicalIsPortrait !== detectionIsPortrait) {
                        console.error(`[GEOMETRY-ERROR] Orientation mismatch detected between detection and normalization spaces. canonical=${canonicalDims.width}x${canonicalDims.height} detection=${detectionDims.width}x${detectionDims.height}`);
                    }

                    const scaleX = canonicalDims.width / detectionDims.width;
                    const scaleY = canonicalDims.height / detectionDims.height;

                    if (__DEV__) {
                        console.log(`[EXIF-AUDIT] scaleX=${scaleX.toFixed(4)} scaleY=${scaleY.toFixed(4)}`);
                    }

                    const scaledQuad: Quadrilateral = {
                        topLeft: { x: detectionQuad.topLeft.x * scaleX, y: detectionQuad.topLeft.y * scaleY },
                        topRight: { x: detectionQuad.topRight.x * scaleX, y: detectionQuad.topRight.y * scaleY },
                        bottomRight: { x: detectionQuad.bottomRight.x * scaleX, y: detectionQuad.bottomRight.y * scaleY },
                        bottomLeft: { x: detectionQuad.bottomLeft.x * scaleX, y: detectionQuad.bottomLeft.y * scaleY },
                    };
                    finalScaledQuad = scaledQuad;

                    // Pass the EXIF-resolved canonical URI so OpenCV.imread loads
                    // an upright image matching the coordinate space of the quad.
                    const norm = await normalizeCapturedDocument(
                        canonicalUri,
                        scaledQuad,
                        canonicalDims,
                    );
                    finalUri = norm.uri;
                } catch (e) {
                    console.warn('[commitCapture] perspective correction failed:', e);
                }
            }

            // Step 2b: Resize if perspective correction didn't run
            if (finalUri === pending.uri) {
                const resized = await ImageManipulator.manipulateAsync(
                    finalUri,
                    [{ resize: { width: 1200 } }],
                    { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
                );
                finalUri = resized.uri;
            }

            // CLEANUP: delete temporary canonical image
            try {
                new File(canonicalUri).delete();
            } catch (_) {}

            // Step 3: Save original un-filtered image
            const origFilename = `orig_${Date.now()}.jpg`;
            const destOrig = new File(Paths.document, origFilename);
            new File(finalUri).copy(destOrig);

            // Poll for original
            let origVerified = false;
            for (let i = 0; i < 10; i++) {
                if (destOrig.exists) { origVerified = true; break; }
                await new Promise(r => setTimeout(r, 50));
            }

            // Step 4: Apply requested OCR filter
            const filteredUri = await applyFilter(destOrig.uri, filter);

            // Step 5: Copy to permanent filtered storage
            const filename = `scanned_${Date.now()}.jpg`;
            const dest = new File(Paths.document, filename);
            new File(filteredUri).copy(dest);

            let verified = false;
            for (let i = 0; i < 10; i++) {
                if (dest.exists) { verified = true; break; }
                await new Promise(r => setTimeout(r, 50));
            }
            if (!verified) {
                console.warn('[commitCapture] file not found after copy');
                return;
            }

            // Step 6: Persist to store
            addPageRef.current({
                id: generateUUID(),
                ui_id: '',
                page_number: 0,
                file_path: dest.uri,
                original_file_path: destOrig.uri,
                raw_file_path: rawVerified ? destRaw.uri : undefined,
                crop_quad: finalScaledQuad || undefined,
                filter_mode: filter,
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
            if (!prev) resetScannerState();
            return !prev;
        });
    }, []);

    const handleNextStudent = useCallback(() => {
        silentNextStudent();
        resetScannerState();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [silentNextStudent]);

    const handleFinishPhase = useCallback(() => {
        const session = useScanStore.getState().currentSession;
        if (!session) return;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (currentPhase === 'question_paper') {
            if (session.settings?.scan_model_answer) {
                useScanStore.getState().setCurrentPhase('model_answer');
            } else {
                useScanStore.getState().setCurrentPhase('students');
            }
        } else if (currentPhase === 'model_answer') {
            useScanStore.getState().setCurrentPhase('students');
        }
        resetScannerState();
    }, [currentPhase]);

    const handleMotionStabilizingChange = useCallback((stabilizing: boolean) => {
        setIsStabilizing(stabilizing);
        if (stabilizing) {
            transitionTo('STABILIZING');
        } else {
            if (scannerPhaseRef.current === 'STABILIZING') {
                transitionTo('SEARCHING');
            }
        }
    }, [transitionTo]);

    // ── Motion stability hook ─────────────────────────────────────────────────
    const {
        isStabilizing: motionStabilizing,
        stabilityProgress: motionProgress,
        averageMotion,
    } = useMotionStability({
        enabled: !isPaused && isCameraReady && !isCapturing && autoCaptureEnabled,
        onStable: triggerCapture,
        waitTime: MOTION_STABILITY_WAIT_TIME,
        motionThreshold: MOTION_THRESHOLD,
        sampleCount: MOTION_SAMPLE_COUNT,
        updateInterval: MOTION_UPDATE_INTERVAL,
        onStabilizingChange: handleMotionStabilizingChange,
    });

    // Sync motion hook state → local UI state
    useEffect(() => {
        setIsStabilizing(motionStabilizing);
    }, [motionStabilizing]);

    useEffect(() => {
        setStabilityProgress(motionStabilizing ? motionProgress : 0);
    }, [motionProgress, motionStabilizing]);

    // ── Status text ───────────────────────────────────────────────────────────
    const getStatusText = (): string => {
        if (isStabilizing) {
            const waitSecs = (MOTION_STABILITY_WAIT_TIME / 1000).toFixed(1);
            return `Stabilizing... ${waitSecs}s`;
        }
        if (liveScanStatus === 'capturing') return 'Capturing…';
        if (liveScanStatus === 'saved') return 'Saved ✓ — move to next page';
        return 'Searching…';
    };

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

                {/* Shutter Flash Overlay */}
                {showShutterFlash && <View style={styles.shutterFlashOverlay} />}

                {/* Floating Flash Toggle */}
                <TouchableOpacity 
                    style={[styles.floatingFlashBtn, { top: insets.top + 60 }]} 
                    onPress={handleToggleFlash}
                >
                    <Ionicons 
                        name={flashMode === 'on' ? 'flash' : flashMode === 'auto' ? 'flash-outline' : 'flash-off'} 
                        size={22} 
                        color={flashMode === 'on' ? '#FFD700' : '#fff'} 
                    />
                    {flashMode === 'auto' && <Text style={styles.flashAutoText}>A</Text>}
                </TouchableOpacity>

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
                                isStabilizing ? '#FFA500' :
                                    liveScanStatus === 'capturing' ? '#FF9800' :
                                        liveScanStatus === 'saved' ? '#2196F3' : '#9E9E9E',
                        },
                    ]} />
                    <Text style={styles.statusText}>
                        {getStatusText()}
                    </Text>
                </View>

                {isStabilizing && (
                    <View style={styles.stabilityProgressContainer}>
                        <View style={[
                            styles.stabilityProgressBar,
                            { width: `${stabilityProgress}%` },
                        ]} />
                    </View>
                )}
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
                onFinishPhase={handleFinishPhase}
                onFinishSession={() => {
                    saveSession();
                    router.replace('/review');
                }}
            />

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
    stabilityProgressContainer: {
        position: 'absolute',
        bottom: 55,
        left: 0,
        right: 0,
        height: 3,
        backgroundColor: 'rgba(255,255,255,0.2)',
        zIndex: 5,
    },
    stabilityProgressBar: {
        height: '100%',
        backgroundColor: '#FFA500',
    },
    floatingFlashBtn: {
        position: 'absolute',
        right: 20,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
    flashAutoText: {
        position: 'absolute',
        bottom: 4,
        right: 6,
        color: '#fff',
        fontSize: 9,
        fontWeight: 'bold',
    },
    shutterFlashOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#fff',
        zIndex: 100,
    },
    thumbStrip: { height: 72, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center' },
    thumbItem: { width: 52, height: 60, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    thumbImage: { width: '100%', height: '100%' },
    blurDot: { position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E24B4A' },
});