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
    Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';
import { detectDocumentInFrame, FilterMode, applyFilter, resetScannerState } from '../src/utils/cvProcessor';
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
import { CVProcessingResult, Quadrilateral, Point } from '../src/utils/cvProcessor';
import { LiveScanStatus } from '../src/components/StatusIndicator';
import { ScannerHeader } from '../src/components/ScannerHeader';
import { ProtectedCameraView } from '../src/components/ProtectedCameraView';
import { ScannerBottomBar } from '../src/components/ScannerBottomBar';
import { detectBlur, BlurDetectionResult } from '../src/utils/blurDetection';
import { Ionicons } from '@expo/vector-icons';
import { useMotionStability } from '../src/hooks/useMotionStability';
import { createImportedPdfPage, createNativeScannedImagePage, isPdfScannedPage } from '../src/utils/scannedPageAssets';
import { useLocalSearchParams } from 'expo-router';
import { evaluateAutoCropCandidate, CropQualityResult } from '../src/utils/cropQuality';
import { detectTextOrientationAndBounds, detectDocumentCorners, detectDocumentWithDocQuad, TextOrientationAndBoundsResult, TextBlockDiagnostic } from '../src/utils/docQuadDetector';
import { getFallbackA4Quad } from '../src/utils/geometryUtils';
import type { ScannedPage, ScanPhase } from '../src/types';
import * as Sentry from '@sentry/react-native';
import { useNetworkQuality } from '../src/utils/networkUtils';

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
const MOTION_STABILITY_WAIT_TIME = 2500;   // ms — wait after stable detected
const MOTION_THRESHOLD = 0.04;   // delta g-units (was 0.5 raw magnitude — wrong)
const MOTION_SAMPLE_COUNT = 5;      // consecutive stable readings required
const MOTION_UPDATE_INTERVAL = 100;    // ms — poll frequency (was 250, too slow for delta)
const AUTO_CAPTURE_CONFIDENCE_THRESHOLD = 0.50;
const POST_CAPTURE_DETECTION_WIDTH = 960;

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
    captureOrientation?: ScreenOrientation.Orientation;
    pageMode: 'single' | 'double';
    phase: ScanPhase;
    studentIndex: number;
    autoCropEnabled: boolean;
}

type PageSplitPart = 'left' | 'right' | 'top' | 'bottom';

interface PreparedImagePart {
    uri: string;
    width: number;
    height: number;
    splitPart?: PageSplitPart;
    cropQuad?: Quadrilateral;
    cropConfidence?: number;
    cropApplied?: boolean;
    rawUri?: string;
}

interface OrientationResult {
    uri: string;
    width: number;
    height: number;
    orientationDegrees: 0 | 90 | 180 | 270;
    needsReview: boolean;
}

function shouldAutoPortraitRotate(width: number, height: number): boolean {
    return width > height * 1.08;
}

function isAmbiguousOrientation(width: number, height: number): boolean {
    const ratio = width / Math.max(1, height);
    return ratio > 0.88 && ratio <= 1.08;
}

function shouldSplitAsDoublePage(width: number, height: number): boolean {
    const ratio = width / height;
    return ratio >= 1.30 || ratio <= 0.77;
}



async function checkIfTwoPagesVisible(
    uri: string,
    width: number,
    height: number,
): Promise<{ visible: boolean; confidence?: number; detectorUsed: 'docquad' | 'opencv' | 'none'; reason?: string; quad?: Quadrilateral }> {
    try {
        // Run only local native DocQuad detector (Fast, on-device) to avoid backend latency
        const docQuadResult = await detectDocumentWithDocQuad(uri);
        if (docQuadResult?.quadrilateral) {
            const quad = docQuadResult.quadrilateral;
            const qPoints = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
            
            const topLen = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
            const bottomLen = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
            const leftLen = Math.hypot(quad.topLeft.x - quad.bottomLeft.x, quad.topLeft.y - quad.bottomLeft.y);
            const rightLen = Math.hypot(quad.topRight.x - quad.bottomRight.x, quad.topRight.y - quad.bottomRight.y);
            
            const avgWidth = (topLen + bottomLen) / 2;
            const avgHeight = (leftLen + rightLen) / 2;
            const quadAspect = avgWidth / Math.max(1, avgHeight);
            
            let minX = docQuadResult.dimensions.width, maxX = 0;
            qPoints.forEach(p => {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
            });
            const quadWidthRatio = (maxX - minX) / docQuadResult.dimensions.width;
            
            console.log('[CROP-DIAGNOSTICS] checkTwoPages(DocQuad):', {
                quadAspect,
                quadWidthRatio,
                confidence: docQuadResult.confidence
            });
            
            if (quadAspect < 1.05) {
                return { visible: true, confidence: docQuadResult.confidence, detectorUsed: 'none', reason: `Single portrait page detected (aspect ratio ${quadAspect.toFixed(2)}), forcing split`, quad };
            }
            if (quadWidthRatio < 0.72) {
                return { visible: true, confidence: docQuadResult.confidence, detectorUsed: 'none', reason: `Single narrow page detected (width coverage ${quadWidthRatio.toFixed(2)}), forcing split`, quad };
            }
            
            return { visible: true, confidence: docQuadResult.confidence, detectorUsed: 'docquad', quad };
        }
    } catch (err) {
        console.warn('[checkTwoPages] DocQuad failed, trying OpenCV fallback:', err);
    }
    
    try {
        let detectionUri = uri;
        let detectionDims = { width, height };
        let downscaled: ImageManipulator.ImageResult | null = null;
        if (width > POST_CAPTURE_DETECTION_WIDTH) {
            downscaled = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: POST_CAPTURE_DETECTION_WIDTH } }],
                { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
            );
            detectionUri = downscaled.uri;
            detectionDims = { width: downscaled.width, height: downscaled.height };
        }
        
        const cvResult = await detectDocumentInFrame(detectionUri, detectionDims.width, detectionDims.height);
        if (downscaled) {
            try { new File(downscaled.uri).delete(); } catch (_) {}
        }
        
        if (cvResult?.quadrilateral) {
            const quad = cvResult.quadrilateral;
            const qPoints = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
            
            const topLen = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
            const bottomLen = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
            const leftLen = Math.hypot(quad.topLeft.x - quad.bottomLeft.x, quad.topLeft.y - quad.bottomLeft.y);
            const rightLen = Math.hypot(quad.topRight.x - quad.bottomRight.x, quad.topRight.y - quad.bottomRight.y);
            
            const avgWidth = (topLen + bottomLen) / 2;
            const avgHeight = (leftLen + rightLen) / 2;
            const quadAspect = avgWidth / Math.max(1, avgHeight);
            
            let minX = detectionDims.width, maxX = 0;
            qPoints.forEach(p => {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
            });
            const quadWidthRatio = (maxX - minX) / detectionDims.width;
            
            console.log('[CROP-DIAGNOSTICS] checkTwoPages(OpenCV):', {
                quadAspect,
                quadWidthRatio,
                confidence: cvResult.confidence
            });
            
            if (quadAspect < 1.05) {
                return { visible: true, confidence: cvResult.confidence, detectorUsed: 'none', reason: `Single portrait page detected via OpenCV (aspect ratio ${quadAspect.toFixed(2)}), forcing split`, quad };
            }
            if (quadWidthRatio < 0.72) {
                return { visible: true, confidence: cvResult.confidence, detectorUsed: 'none', reason: `Single narrow page detected via OpenCV (width coverage ${quadWidthRatio.toFixed(2)}), forcing split`, quad };
            }
            
            return { visible: true, confidence: cvResult.confidence, detectorUsed: 'opencv', quad };
        }
    } catch (err) {
        console.warn('[checkTwoPages] OpenCV fallback failed:', err);
    }
    
    return { visible: true, detectorUsed: 'none', reason: 'No document detected, falling back to split' };
}

async function detectDoublePageOrientation(
    uri: string,
    width: number,
    height: number,
): Promise<TextOrientationAndBoundsResult | null> {
    // To detect orientation on a double-page spread, we crop a temporary single page half of the spread.
    // ML Kit text recognition is highly accurate on single pages, whereas it often fails or returns 0
    // on a full landscape double page spread due to split-column layouts.
    try {
        let cropRect;
        if (width >= height) {
            // Landscape spread: crop the left half
            cropRect = { originX: 0, originY: 0, width: Math.floor(width / 2), height };
        } else {
            // Portrait spread (captured sideways): crop the top half
            cropRect = { originX: 0, originY: 0, width, height: Math.floor(height / 2) };
        }
        
        const halfImage = await ImageManipulator.manipulateAsync(
            uri,
            [{ crop: cropRect }],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
        );
        
        console.log('[detectDoublePageOrientation] Temp crop created for orientation detection:', cropRect);
        const res = await detectTextOrientationAndBounds(halfImage.uri);
        
        try {
            new File(halfImage.uri).delete();
        } catch (_) {}
        
        return res;
    } catch (err) {
        console.warn('[detectDoublePageOrientation] error:', err);
        return null;
    }
}

async function normalizeDoublePageSource(
    uri: string,
    width: number,
    height: number,
    captureOrientation?: ScreenOrientation.Orientation,
): Promise<PreparedImagePart> {
    // In double-page mode, we always want the combined spread image to be landscape-oriented (width > height)
    // so it represents two pages side-by-side (left and right).
    // If it is portrait (height > width), the book is captured sideways in the frame.
    // We rotate it based on the physical device orientation (90 or 270) to lay it out landscape
    // with the left page physically on the left side of the image.
    if (height > width) {
        let rotationAngle = 90;
        if (captureOrientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
            rotationAngle = 270;
        } else if (captureOrientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT) {
            rotationAngle = 90;
        }
        
        console.log('[normalizeDoublePageSource] Portrait spread detected, rotating landscape based on captureOrientation:', rotationAngle);
        const rotated = await ImageManipulator.manipulateAsync(
            uri,
            [{ rotate: rotationAngle }],
            { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
        );
        return { uri: rotated.uri, width: rotated.width, height: rotated.height };
    }

    return { uri, width, height };
}

async function autoOrientPageImage(
    uri: string,
    width: number,
    height: number,
): Promise<OrientationResult> {
    try {
        const orientationRes = await detectTextOrientationAndBounds(uri);
        if (orientationRes && orientationRes.hasText) {
            const rot = orientationRes.rotationNeeded;
            console.log('[autoOrientPageImage] ML Kit Text Orientation rotationNeeded:', rot);
            if (rot !== 0) {
                const rotated = await ImageManipulator.manipulateAsync(
                    uri,
                    [{ rotate: rot }],
                    { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
                );
                return {
                    uri: rotated.uri,
                    width: rotated.width,
                    height: rotated.height,
                    orientationDegrees: rot,
                    needsReview: false,
                };
            } else {
                return {
                    uri,
                    width,
                    height,
                    orientationDegrees: 0,
                    needsReview: false,
                };
            }
        }
    } catch (err) {
        console.warn('[autoOrientPageImage] ML Kit orientation detection failed, falling back to dimension check:', err);
    }

    // Fallback to aspect ratio check
    if (shouldAutoPortraitRotate(width, height)) {
        const rotated = await ImageManipulator.manipulateAsync(
            uri,
            [{ rotate: 90 }],
            { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
        );
        return {
            uri: rotated.uri,
            width: rotated.width,
            height: rotated.height,
            orientationDegrees: 90,
            needsReview: false,
        };
    }

    return {
        uri,
        width,
        height,
        orientationDegrees: 0,
        needsReview: isAmbiguousOrientation(width, height),
    };
}

async function splitDoublePageImage(
    uri: string,
    width: number,
    height: number,
): Promise<PreparedImagePart[]> {
    if (!shouldSplitAsDoublePage(width, height)) {
        return [{ uri, width, height }];
    }

    if (width >= height) {
        const overlap = Math.round(width * 0.018);
        const mid = Math.floor(width / 2);
        const leftWidth = Math.min(width, mid + overlap);
        const rightX = Math.max(0, mid - overlap);
        const rightWidth = width - rightX;
        const left = await ImageManipulator.manipulateAsync(
            uri,
            [{ crop: { originX: 0, originY: 0, width: leftWidth, height } }],
            { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
        );
        const right = await ImageManipulator.manipulateAsync(
            uri,
            [{ crop: { originX: rightX, originY: 0, width: rightWidth, height } }],
            { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
        );
        return [
            { uri: left.uri, width: left.width, height: left.height, splitPart: 'left', rawUri: left.uri },
            { uri: right.uri, width: right.width, height: right.height, splitPart: 'right', rawUri: right.uri },
        ];
    } else {
        const overlap = Math.round(height * 0.018);
        const mid = Math.floor(height / 2);
        const topHeight = Math.min(height, mid + overlap);
        const bottomY = Math.max(0, mid - overlap);
        const bottomHeight = height - bottomY;
        const top = await ImageManipulator.manipulateAsync(
            uri,
            [{ crop: { originX: 0, originY: 0, width, height: topHeight } }],
            { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
        );
        const bottom = await ImageManipulator.manipulateAsync(
            uri,
            [{ crop: { originX: 0, originY: bottomY, width, height: bottomHeight } }],
            { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
        );
        return [
            { uri: top.uri, width: top.width, height: top.height, splitPart: 'top', rawUri: top.uri },
            { uri: bottom.uri, width: bottom.width, height: bottom.height, splitPart: 'bottom', rawUri: bottom.uri },
        ];
    }
}

function splitQuadrilateral(
    quad: Quadrilateral,
    splitDir: 'horizontal' | 'vertical'
): { first: Quadrilateral; second: Quadrilateral } {
    const TL = quad.topLeft;
    const TR = quad.topRight;
    const BR = quad.bottomRight;
    const BL = quad.bottomLeft;

    if (splitDir === 'horizontal') {
        const midTop = {
            x: (TL.x + TR.x) / 2,
            y: (TL.y + TR.y) / 2,
        };
        const midBottom = {
            x: (BL.x + BR.x) / 2,
            y: (BL.y + BR.y) / 2,
        };
        return {
            first: { topLeft: TL, topRight: midTop, bottomRight: midBottom, bottomLeft: BL },
            second: { topLeft: midTop, topRight: TR, bottomRight: BR, bottomLeft: midBottom },
        };
    } else {
        const midLeft = {
            x: (TL.x + BL.x) / 2,
            y: (TL.y + BL.y) / 2,
        };
        const midRight = {
            x: (TR.x + BR.x) / 2,
            y: (TR.y + BR.y) / 2,
        };
        return {
            first: { topLeft: TL, topRight: TR, bottomRight: midRight, bottomLeft: midLeft },
            second: { topLeft: midLeft, topRight: midRight, bottomRight: BR, bottomLeft: BL },
        };
    }
}

function adjustQuadForSplitOffset(
    quad: Quadrilateral,
    splitPart: PageSplitPart,
    width: number,
    height: number
): Quadrilateral {
    if (width >= height) {
        if (splitPart === 'right') {
            const overlap = Math.round(width * 0.018);
            const mid = Math.floor(width / 2);
            const rightX = Math.max(0, mid - overlap);
            
            const shiftPoint = (p: Point) => ({ x: Math.max(0, p.x - rightX), y: p.y });
            return {
                topLeft: shiftPoint(quad.topLeft),
                topRight: shiftPoint(quad.topRight),
                bottomRight: shiftPoint(quad.bottomRight),
                bottomLeft: shiftPoint(quad.bottomLeft),
            };
        }
    } else {
        if (splitPart === 'bottom') {
            const overlap = Math.round(height * 0.018);
            const mid = Math.floor(height / 2);
            const bottomY = Math.max(0, mid - overlap);
            
            const shiftPoint = (p: Point) => ({ x: p.x, y: Math.max(0, p.y - bottomY) });
            return {
                topLeft: shiftPoint(quad.topLeft),
                topRight: shiftPoint(quad.topRight),
                bottomRight: shiftPoint(quad.bottomRight),
                bottomLeft: shiftPoint(quad.bottomLeft),
            };
        }
    }
    return quad;
}

function scaleQuadToDimensions(
    quad: Quadrilateral,
    from: { width: number; height: number },
    to: { width: number; height: number },
): Quadrilateral {
    const scaleX = to.width / Math.max(1, from.width);
    const scaleY = to.height / Math.max(1, from.height);
    return {
        topLeft: { x: quad.topLeft.x * scaleX, y: quad.topLeft.y * scaleY },
        topRight: { x: quad.topRight.x * scaleX, y: quad.topRight.y * scaleY },
        bottomRight: { x: quad.bottomRight.x * scaleX, y: quad.bottomRight.y * scaleY },
        bottomLeft: { x: quad.bottomLeft.x * scaleX, y: quad.bottomLeft.y * scaleY },
    };
}

function isPointInQuad(p: Point, quad: Quadrilateral): boolean {
    const crossProduct = (a: Point, b: Point, p: Point) => {
        return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    };

    const cp1 = crossProduct(quad.topLeft, quad.topRight, p);
    const cp2 = crossProduct(quad.topRight, quad.bottomRight, p);
    const cp3 = crossProduct(quad.bottomRight, quad.bottomLeft, p);
    const cp4 = crossProduct(quad.bottomLeft, quad.topLeft, p);

    const hasNeg = (cp1 < 0) || (cp2 < 0) || (cp3 < 0) || (cp4 < 0);
    const hasPos = (cp1 > 0) || (cp2 > 0) || (cp3 > 0) || (cp4 > 0);

    return !(hasNeg && hasPos);
}

function rotateBoundingBox(
    box: { left: number; top: number; right: number; bottom: number },
    rotation: 0 | 90 | 180 | 270,
    origW: number,
    origH: number
) {
    if (rotation === 0) return box;
    if (rotation === 90) {
        return {
            left: origH - box.bottom,
            top: box.left,
            right: origH - box.top,
            bottom: box.right
        };
    } else if (rotation === 180) {
        return {
            left: origW - box.right,
            top: origH - box.bottom,
            right: origW - box.left,
            bottom: origH - box.top
        };
    } else if (rotation === 270) {
        return {
            left: box.top,
            top: origW - box.right,
            right: box.bottom,
            bottom: origW - box.left
        };
    }
    return box;
}

function doesCropCutText(
    quad: Quadrilateral,
    targets: Array<{ left: number; top: number; right: number; bottom: number }>
): boolean {
    for (const target of targets) {
        const corners = [
            { x: target.left, y: target.top },
            { x: target.right, y: target.top },
            { x: target.right, y: target.bottom },
            { x: target.left, y: target.bottom },
        ];

        for (const pt of corners) {
            if (!isPointInQuad(pt, quad)) {
                return true;
            }
        }
    }
    return false;
}

function recoverAndExpandQuad(
    quad: Quadrilateral,
    targets: Array<{ left: number; top: number; right: number; bottom: number }>,
    width: number,
    height: number
): Quadrilateral | null {
    const expanded = {
        topLeft: { ...quad.topLeft },
        topRight: { ...quad.topRight },
        bottomRight: { ...quad.bottomRight },
        bottomLeft: { ...quad.bottomLeft },
    };

    const cx = (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4;
    const cy = (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4;

    let modified = false;

    for (const target of targets) {
        const corners = [
            { x: target.left, y: target.top },
            { x: target.right, y: target.top },
            { x: target.right, y: target.bottom },
            { x: target.left, y: target.bottom },
        ];

        for (const pt of corners) {
            if (!isPointInQuad(pt, expanded)) {
                const isRight = pt.x > cx;
                const isBottom = pt.y > cy;

                if (!isRight && !isBottom) {
                    expanded.topLeft = { x: width * 0.02, y: height * 0.02 };
                } else if (isRight && !isBottom) {
                    expanded.topRight = { x: width * 0.98, y: height * 0.02 };
                } else if (isRight && isBottom) {
                    expanded.bottomRight = { x: width * 0.98, y: height * 0.98 };
                } else {
                    expanded.bottomLeft = { x: width * 0.02, y: height * 0.98 };
                }
                modified = true;
            }
        }
    }

    if (modified) {
        if (!doesCropCutText(expanded, targets)) {
            console.log('[commitCapture] Corner recovery/expansion successful:', expanded);
            return expanded;
        } else {
            console.warn('[commitCapture] Corner recovery/expansion failed to enclose all text.');
            return null;
        }
    }

    return quad;
}

function isConvex(pts: Quadrilateral): boolean {
    const corners = [pts.topLeft, pts.topRight, pts.bottomRight, pts.bottomLeft];
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const c = corners[(i + 2) % 4];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (cross > 0) positive++;
        if (cross < 0) negative++;
    }
    return positive === 4 || negative === 4;
}

function polygonArea(pts: Quadrilateral): number {
    const corners = [pts.topLeft, pts.topRight, pts.bottomRight, pts.bottomLeft];
    let area = 0;
    for (let i = 0; i < 4; i++) {
        const next = corners[(i + 1) % 4];
        area += corners[i].x * next.y - next.x * corners[i].y;
    }
    return Math.abs(area) / 2;
}
function refineQuadWithTextBounds(
    quad: Quadrilateral,
    textBounds: { left: number; top: number; right: number; bottom: number },
    width: number,
    height: number,
    textBlocks: Array<{ left: number; top: number; right: number; bottom: number }>
): Quadrilateral {
    const textW = textBounds.right - textBounds.left;
    const textH = textBounds.bottom - textBounds.top;
    if (textW <= 0 || textH <= 0 || textBlocks.length === 0) return quad;

    const cx = (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4;
    const cy = (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4;

    const distSq = (p1: Point, p2: Point) => (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;

    const maxCornerDistSq = Math.max(
        distSq(quad.topLeft, { x: cx, y: cy }),
        distSq(quad.topRight, { x: cx, y: cy }),
        distSq(quad.bottomRight, { x: cx, y: cy }),
        distSq(quad.bottomLeft, { x: cx, y: cy })
    );

    // Filter out text blocks that are far from the quad center (adjacent pages / bedsheet noise)
    const validBlocks = textBlocks.filter(block => {
        const bcx = (block.left + block.right) / 2;
        const bcy = (block.top + block.bottom) / 2;
        const centerDistSq = distSq({ x: bcx, y: bcy }, { x: cx, y: cy });
        // Capping at 1.25x the corner distance (squared is 1.5625)
        return centerDistSq <= maxCornerDistSq * 1.5625;
    });

    if (validBlocks.length === 0) return quad;

    // Helper to find scale factor needed to contain a point
    const findScaleForPoint = (p: Point): number => {
        if (isPointInQuad(p, quad)) return 1.0;

        let low = 1.0;
        let high = 1.3; // Cap search at 1.3
        let best = 1.3;

        for (let iter = 0; iter < 8; iter++) {
            const mid = (low + high) / 2;
            const testQuad: Quadrilateral = {
                topLeft: { x: cx + (quad.topLeft.x - cx) * mid, y: cy + (quad.topLeft.y - cy) * mid },
                topRight: { x: cx + (quad.topRight.x - cx) * mid, y: cy + (quad.topRight.y - cy) * mid },
                bottomRight: { x: cx + (quad.bottomRight.x - cx) * mid, y: cy + (quad.bottomRight.y - cy) * mid },
                bottomLeft: { x: cx + (quad.bottomLeft.x - cx) * mid, y: cy + (quad.bottomLeft.y - cy) * mid },
            };
            if (isPointInQuad(p, testQuad)) {
                best = mid;
                high = mid;
            } else {
                low = mid;
            }
        }
        return best;
    };

    let maxScaleRequired = 1.0;

    // Evaluate all corner points of valid text blocks
    for (const block of validBlocks) {
        const corners = [
            { x: block.left, y: block.top },
            { x: block.right, y: block.top },
            { x: block.right, y: block.bottom },
            { x: block.left, y: block.bottom },
        ];
        for (const pt of corners) {
            const s = findScaleForPoint(pt);
            if (s > maxScaleRequired) {
                maxScaleRequired = s;
            }
        }
    }

    // Capping scaling at 1.2 for safety
    const finalScale = Math.min(1.2, maxScaleRequired);

    if (finalScale <= 1.0) {
        return quad;
    }

    // Apply proportional scaling + add a small 3% margin beyond the required scale
    const scaleToApply = Math.min(1.2, finalScale * 1.03);

    const refined: Quadrilateral = {
        topLeft: { x: cx + (quad.topLeft.x - cx) * scaleToApply, y: cy + (quad.topLeft.y - cy) * scaleToApply },
        topRight: { x: cx + (quad.topRight.x - cx) * scaleToApply, y: cy + (quad.topRight.y - cy) * scaleToApply },
        bottomRight: { x: cx + (quad.bottomRight.x - cx) * scaleToApply, y: cy + (quad.bottomRight.y - cy) * scaleToApply },
        bottomLeft: { x: cx + (quad.bottomLeft.x - cx) * scaleToApply, y: cy + (quad.bottomLeft.y - cy) * scaleToApply },
    };

    // Clamp corners to image dimensions
    const clamp = (val: number, max: number) => Math.max(0, Math.min(max, val));
    refined.topLeft.x = clamp(refined.topLeft.x, width);
    refined.topLeft.y = clamp(refined.topLeft.y, height);
    refined.topRight.x = clamp(refined.topRight.x, width);
    refined.topRight.y = clamp(refined.topRight.y, height);
    refined.bottomRight.x = clamp(refined.bottomRight.x, width);
    refined.bottomRight.y = clamp(refined.bottomRight.y, height);
    refined.bottomLeft.x = clamp(refined.bottomLeft.x, width);
    refined.bottomLeft.y = clamp(refined.bottomLeft.y, height);

    // Final safety check for convexity and area ratio
    const area = polygonArea(refined);
    const imgArea = width * height;
    const areaRatio = area / imgArea;
    if (areaRatio < 0.1 || areaRatio > 0.98 || !isConvex(refined)) {
        return quad;
    }

    return refined;
}
async function refineSplitPartCrop(part: PreparedImagePart): Promise<PreparedImagePart> {
    const partDims = { width: part.width, height: part.height };
    let detectionQuad: Quadrilateral | null = null;
    let detectionDims = partDims;
    let cropConfidence: number | undefined;
    let cropProfile: 'standard' | 'docquad' = 'standard';
    let isFallbackQuad = false;

    let textBlocks: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    let hasText = false;
    let textBounds: { left: number; top: number; right: number; bottom: number } | undefined;

    try {
        const mlKitRes = await detectTextOrientationAndBounds(part.uri);
        if (mlKitRes) {
            hasText = mlKitRes.hasText;
            textBounds = mlKitRes.textBounds;
            if (mlKitRes.blocks) {
                mlKitRes.blocks.forEach(b => {
                    if (b.boundingBox) {
                        textBlocks.push(b.boundingBox);
                    }
                });
            }
        }
    } catch (err) {
        console.warn('[refineSplitPartCrop] ML Kit bounds check failed:', err);
    }

    try {
        const docQuadResult = await detectDocumentCorners(part.uri);
        if (docQuadResult?.quadrilateral) {
            const gate = evaluateAutoCropCandidate(docQuadResult.quadrilateral, docQuadResult.dimensions, {
                confidence: docQuadResult.confidence,
                profile: 'docquad',
            });
            if (gate.accepted) {
                const scaled = scaleQuadToDimensions(docQuadResult.quadrilateral, docQuadResult.dimensions, partDims);
                detectionQuad = scaled;
                detectionDims = partDims;
                cropConfidence = docQuadResult.confidence;
                cropProfile = 'docquad';
            }
        }
    } catch (err) {
        console.warn('[splitCrop] DocQuad detection failed:', err);
    }

    if (!detectionQuad) {
        let detectionUri = part.uri;
        let downscaled: ImageManipulator.ImageResult | null = null;
        try {
            if (part.width > POST_CAPTURE_DETECTION_WIDTH) {
                downscaled = await ImageManipulator.manipulateAsync(
                    part.uri,
                    [{ resize: { width: POST_CAPTURE_DETECTION_WIDTH } }],
                    { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
                );
                detectionUri = downscaled.uri;
                detectionDims = { width: downscaled.width, height: downscaled.height };
            }

            const cvResult = await detectDocumentInFrame(detectionUri, detectionDims.width, detectionDims.height);
            if (cvResult.isDocumentDetected && cvResult.quadrilateral) {
                const gate = evaluateAutoCropCandidate(cvResult.quadrilateral, detectionDims, {
                    confidence: cvResult.confidence,
                    areaScore: cvResult.areaScore,
                });
                if (gate.accepted) {
                    const scaled = scaleQuadToDimensions(cvResult.quadrilateral, detectionDims, partDims);
                    detectionQuad = scaled;
                    detectionDims = partDims;
                    cropConfidence = cvResult.confidence;
                    cropProfile = 'standard';
                }
            }
        } catch (err) {
            console.warn('[splitCrop] OpenCV detection failed:', err);
        } finally {
            if (downscaled) {
                try { new File(downscaled.uri).delete(); } catch (_) {}
            }
        }
    }

    // FALLBACK: If both DocQuad and OpenCV failed, default to text-based crop if available, otherwise a safe A4 crop
    if (!detectionQuad) {
        isFallbackQuad = true;
        if (hasText && textBounds && textBlocks.length > 0) {
            const textW = textBounds.right - textBounds.left;
            const textH = textBounds.bottom - textBounds.top;
            const padX = Math.max(part.width * 0.06, textW * 0.12);
            const padY = Math.max(part.height * 0.06, textH * 0.12);
            detectionQuad = {
                topLeft: { x: Math.max(0, textBounds.left - padX), y: Math.max(0, textBounds.top - padY) },
                topRight: { x: Math.min(part.width, textBounds.right + padX), y: Math.max(0, textBounds.top - padY) },
                bottomRight: { x: Math.min(part.width, textBounds.right + padX), y: Math.min(part.height, textBounds.bottom + padY) },
                bottomLeft: { x: Math.max(0, textBounds.left - padX), y: Math.min(part.height, textBounds.bottom + padY) }
            };
            detectionDims = partDims;
            cropConfidence = 0.95;
            cropProfile = 'docquad';
            console.log('[refineSplitPartCrop] Fallback to text-based crop SUCCESS:', detectionQuad);
        } else {
            detectionQuad = getFallbackA4Quad(part.width, part.height);
            detectionDims = partDims;
            cropConfidence = 0.95;
            cropProfile = 'docquad';
            console.log('[refineSplitPartCrop] Fallback to safe centered A4 crop SUCCESS:', detectionQuad);
        }
    }

    if (!detectionQuad) return part;

    try {
        const scaledQuad = scaleQuadToDimensions(detectionQuad, detectionDims, partDims);
        const gate = isFallbackQuad ? { accepted: true } : evaluateAutoCropCandidate(scaledQuad, partDims, {
            confidence: cropConfidence,
            profile: cropProfile,
        });
        if (!gate.accepted) return part;

        const normalized = await normalizeCapturedDocument(part.uri, scaledQuad, partDims, {
            cropProfile,
        });
        return {
            ...part,
            uri: normalized.uri,
            width: normalized.width,
            height: normalized.height,
            cropQuad: scaledQuad,
            cropConfidence,
            cropApplied: true,
        };
    } catch (err) {
        console.warn('[splitCrop] Perspective correction failed:', err);
        return part;
    }
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
    const { returnToUpload, sessionId, mode } = useLocalSearchParams<{ returnToUpload?: string; sessionId?: string; mode?: string }>();
    const shouldReturnToUpload = returnToUpload === '1';
    const shouldLaunchNativeScanner = mode === 'native';
    const insets = useSafeAreaInsets();
    const networkQuality = useNetworkQuality();
    const cameraRef = useRef<CameraView>(null);
    const isMounted = useRef(true);
    const [permission, requestPermission] = useCameraPermissions();

    // ── Store ──────────────────────────────────────────────────────────────────
    const currentPhase = useScanStore(s => s.currentPhase);
    const currentStudentIndex = useScanStore(s => s.currentStudentIndex);
    const autoCaptureEnabled = useScanStore(s => s.autoCaptureEnabled);
    const flashMode = useScanStore(s => s.flashMode);
    const pendingRetake = useScanStore(s => s.pendingRetake);
    const pageMode = useScanStore(s => s.currentSession?.settings.page_mode ?? 'single');

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
    const nativeScannerLaunchedRef = useRef(false);

    const scannerPhaseRef = useRef<ScannerPhase>('SEARCHING');
    const cooldownEndRef = useRef(0);

    // ── React state ────────────────────────────────────────────────────────────
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isNativeScanning, setIsNativeScanning] = useState(false);
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
            let captureOrientation: ScreenOrientation.Orientation | undefined;
            try {
                captureOrientation = await ScreenOrientation.getOrientationAsync();
            } catch (_) {
                captureOrientation = undefined;
            }

            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            const blur = await detectBlur(photo.uri);
            if (blur.level === 'very_blurry') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }

            const storeState = useScanStore.getState();
            const pending: PendingCapture = {
                uri: photo.uri,
                blur,
                quad: lastQuadRef.current,
                dims: cvResultRef.current?.dimensions ?? { width: 480, height: 640 },
                rawDims: { width: photo.width, height: photo.height },
                captureOrientation,
                pageMode: storeState.currentSession?.settings.page_mode ?? 'single',
                phase: storeState.currentPhase,
                studentIndex: storeState.currentStudentIndex,
                autoCropEnabled: storeState.autoCropEnabled,
            };

            // Commit with a natural document-clean filter, while preserving the
            // original image separately for fallback and manual re-filtering.
            await commitCapture(pending, 'high_contrast');
        } catch (e) {
            console.warn('[triggerCapture] error:', e);
            Sentry.captureException(e, { tags: { area: 'triggerCapture' } });
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

        let uprightUriToCleanup: string | null = null;

        try {
            let finalUri = pending.uri;
            let finalDims = { width: pending.rawDims.width, height: pending.rawDims.height };

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
            finalDims = canonicalDims;

            if (__DEV__) {
                console.log(`[EXIF-AUDIT] canonicalDims=${canonical.width}x${canonical.height} rawDims=${pending.rawDims.width}x${pending.rawDims.height}`);
            }

            // ── PHASE 1.5: Detect text orientation and auto-rotate ──────
            let uprightUri = canonicalUri;
            let uprightDims = { ...canonicalDims };
            let autoRotationDegrees: 0 | 90 | 180 | 270 = 0;
            let hasText = false;
            let textBounds: { left: number; top: number; right: number; bottom: number } | undefined;
            let rotatedBlocks: Array<{ left: number; top: number; right: number; bottom: number }> = [];
            let textOrientationDetected = false;

            try {
                const orientationRes = pending.pageMode === 'double'
                    ? await detectDoublePageOrientation(canonicalUri, canonicalDims.width, canonicalDims.height)
                    : await detectTextOrientationAndBounds(canonicalUri);
                if (orientationRes) {
                    textOrientationDetected = true;
                    autoRotationDegrees = orientationRes.rotationNeeded;
                    hasText = orientationRes.hasText;
                    
                    if (autoRotationDegrees !== 0) {
                        console.log('[commitCapture] Rotating raw image to be upright:', autoRotationDegrees);
                        const rotated = await ImageManipulator.manipulateAsync(
                            canonicalUri,
                            [{ rotate: autoRotationDegrees }],
                            { compress: 0.98, format: ImageManipulator.SaveFormat.JPEG }
                        );
                        uprightUri = rotated.uri;
                        uprightUriToCleanup = rotated.uri;
                        uprightDims = { width: rotated.width, height: rotated.height };
                    }

                    console.log('[commitCapture] ML Kit Text Orientation:', {
                        rotationNeeded: autoRotationDegrees,
                        hasText,
                        originalDims: `${orientationRes.width}x${orientationRes.height}`,
                        uprightDims: `${uprightDims.width}x${uprightDims.height}`
                    });

                    // Transform textBounds to the new upright/rotated space
                    if (pending.pageMode !== 'double') {
                        if (orientationRes.textBounds) {
                            textBounds = rotateBoundingBox(
                                orientationRes.textBounds,
                                autoRotationDegrees,
                                canonicalDims.width,
                                canonicalDims.height
                            );
                        }

                        const blocks = orientationRes.blocks || [];
                        blocks.forEach((b: TextBlockDiagnostic) => {
                            if (b.boundingBox) {
                                // Rotate individual block bounds to the upright/rotated space
                                const rotBox = rotateBoundingBox(
                                    b.boundingBox,
                                    autoRotationDegrees,
                                    canonicalDims.width,
                                    canonicalDims.height
                                );
                                rotatedBlocks.push(rotBox);
                            }
                        });
                    }
                }
            } catch (err) {
                console.warn('[commitCapture] ML Kit Orientation detection failed:', err);
            }

            finalDims = uprightDims;
            finalUri = uprightUri;

            // Step 1: Post-Capture Auto-Crop Detection
            let detectionQuad: Quadrilateral | null = null;
            let detectionDims = uprightDims;
            let finalScaledQuad: Quadrilateral | null = null;
            let cropConfidence: number | undefined;
            let cropProfile: 'standard' | 'docquad' = 'standard';
            let isFallbackQuad = false;

            // Save raw un-warped camera image (EXIF-baked to be upright)
            const rawFilename = `raw_${Date.now()}.jpg`;
            const destRaw = new File(Paths.document, rawFilename);
            new File(uprightUri).copy(destRaw);
            let rawVerified = false;
            for (let i = 0; i < 10; i++) {
                if (destRaw.exists) { rawVerified = true; break; }
                await new Promise(r => setTimeout(r, 50));
            }

            const scanStateForCrop = useScanStore.getState();
            const isDoublePageCapture =
                scanStateForCrop.currentSession?.settings.page_mode === 'double' &&
                !scanStateForCrop.pendingRetake;
            if (scanStateForCrop.autoCropEnabled && isDoublePageCapture) {
                console.log('[commitCapture] Skipping auto-crop in 2-page mode to avoid warping before split.');
            }

            try {
                if (scanStateForCrop.autoCropEnabled && !isDoublePageCapture) {
                    try {
                        const docQuadResult = await detectDocumentCorners(uprightUri);
                        if (docQuadResult?.quadrilateral) {
                            const docQuadGate = evaluateAutoCropCandidate(
                                docQuadResult.quadrilateral,
                                docQuadResult.dimensions,
                                { confidence: docQuadResult.confidence, profile: 'docquad' }
                            );
                            if (docQuadGate.accepted) {
                                const scaled = scaleQuadToDimensions(docQuadResult.quadrilateral, docQuadResult.dimensions, uprightDims);
                                detectionQuad = scaled;
                                detectionDims = uprightDims;
                                cropConfidence = docQuadResult.confidence;
                                cropProfile = 'docquad';
                                console.log('[commitCapture] DocQuad detection SUCCESS', {
                                    confidence: docQuadResult.confidence,
                                    metrics: docQuadGate.metrics,
                                });
                            } else {
                                console.warn('[commitCapture] DocQuad rejected. Falling back to OpenCV detector.', {
                                    reason: docQuadGate.reason,
                                    confidence: docQuadResult.confidence,
                                    metrics: docQuadGate.metrics,
                                });
                            }
                        } else {
                            console.log('[commitCapture] DocQuad did not find a document. Trying OpenCV fallback.');
                        }
                    } catch (docQuadErr) {
                        console.warn('[commitCapture] DocQuad detection error. Trying OpenCV fallback:', docQuadErr);
                    }

                    if (detectionQuad) {
                        console.log('[commitCapture] Skipping OpenCV fallback because DocQuad produced an accepted crop.');
                    } else {
                        // Downscale the upright image
                        const downscaled = await ImageManipulator.manipulateAsync(
                            uprightUri,
                            [{ resize: { width: POST_CAPTURE_DETECTION_WIDTH } }],
                            { base64: false, format: ImageManipulator.SaveFormat.JPEG, compress: 0.72 }
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
                                const cropGate = evaluateAutoCropCandidate(
                                    cvResult.quadrilateral,
                                    { width: downscaled.width, height: downscaled.height },
                                    { confidence: cvResult.confidence, areaScore: cvResult.areaScore }
                                );
                                if (!cropGate.accepted) {
                                    console.warn('[commitCapture] Auto-crop rejected. Falling back to full image.', {
                                        reason: cropGate.reason,
                                        metrics: cropGate.metrics,
                                    });
                                } else {
                                    const scaled = scaleQuadToDimensions(cvResult.quadrilateral, { width: downscaled.width, height: downscaled.height }, uprightDims);
                                    detectionQuad = scaled;
                                    detectionDims = uprightDims;
                                    cropConfidence = cvResult.confidence;
                                    cropProfile = 'standard';
                                    console.log('[commitCapture] Post-capture detection SUCCESS');
                                }
                            } else {
                                console.log('[commitCapture] Post-capture detection failed to find document. Falling back to original image.');
                            }

                            // CLEANUP: delete temporary downscaled file
                            try {
                                new File(downscaled.uri).delete();
                            } catch (_) {}
                        }
                    }

                    // FALLBACK: If both DocQuad and OpenCV failed, default to text-based crop if available, otherwise a safe centered A4 crop
                    if (!detectionQuad) {
                        isFallbackQuad = true;
                        if (hasText && textBounds && rotatedBlocks.length > 0) {
                            const textW = textBounds.right - textBounds.left;
                            const textH = textBounds.bottom - textBounds.top;
                            const padX = Math.max(uprightDims.width * 0.06, textW * 0.12);
                            const padY = Math.max(uprightDims.height * 0.06, textH * 0.12);
                            detectionQuad = {
                                topLeft: { x: Math.max(0, textBounds.left - padX), y: Math.max(0, textBounds.top - padY) },
                                topRight: { x: Math.min(uprightDims.width, textBounds.right + padX), y: Math.max(0, textBounds.top - padY) },
                                bottomRight: { x: Math.min(uprightDims.width, textBounds.right + padX), y: Math.min(uprightDims.height, textBounds.bottom + padY) },
                                bottomLeft: { x: Math.max(0, textBounds.left - padX), y: Math.min(uprightDims.height, textBounds.bottom + padY) }
                            };
                            detectionDims = uprightDims;
                            cropConfidence = 0.95;
                            cropProfile = 'docquad';
                            console.log('[commitCapture] Fallback to text-based crop SUCCESS:', detectionQuad);
                        } else {
                            detectionQuad = getFallbackA4Quad(uprightDims.width, uprightDims.height);
                            detectionDims = uprightDims;
                            cropConfidence = 0.95;
                            cropProfile = 'docquad';
                            console.log('[commitCapture] Fallback to safe centered A4 crop SUCCESS:', detectionQuad);
                        }
                    }
                } else if (!scanStateForCrop.autoCropEnabled) {
                    console.log('[commitCapture] Auto-crop disabled. Skipping post-capture detection.');
                } else {
                    console.log('[commitCapture] Auto-crop skipped for 2-page capture; splitting original image first.');
                }
            } catch (detectErr) {
                console.warn('[commitCapture] post-capture detection error:', detectErr);
            }

            // Step 2: Perspective correction with scaled coordinates
            if (detectionQuad?.topLeft && detectionDims) {
                try {
                    const uprightIsPortrait = uprightDims.width < uprightDims.height;
                    const detectionIsPortrait = detectionDims.width < detectionDims.height;
                    if (uprightIsPortrait !== detectionIsPortrait) {
                        console.error(`[GEOMETRY-ERROR] Orientation mismatch detected. upright=${uprightDims.width}x${uprightDims.height} detection=${detectionDims.width}x${detectionDims.height}`);
                    }

                    const scaleX = uprightDims.width / detectionDims.width;
                    const scaleY = uprightDims.height / detectionDims.height;

                    if (__DEV__) {
                        console.log(`[EXIF-AUDIT] scaleX=${scaleX.toFixed(4)} scaleY=${scaleY.toFixed(4)}`);
                    }

                    const scaledQuad: Quadrilateral = {
                        topLeft: { x: detectionQuad.topLeft.x * scaleX, y: detectionQuad.topLeft.y * scaleY },
                        topRight: { x: detectionQuad.topRight.x * scaleX, y: detectionQuad.topRight.y * scaleY },
                        bottomRight: { x: detectionQuad.bottomRight.x * scaleX, y: detectionQuad.bottomRight.y * scaleY },
                        bottomLeft: { x: detectionQuad.bottomLeft.x * scaleX, y: detectionQuad.bottomLeft.y * scaleY },
                    };
                    const scaledCropGate = (isFallbackQuad ? { accepted: true } : evaluateAutoCropCandidate(scaledQuad, uprightDims, {
                        profile: cropProfile,
                    })) as CropQualityResult;
                    if (!scaledCropGate.accepted) {
                        console.warn('[commitCapture] Scaled auto-crop rejected before warp. Falling back to full image.', {
                            reason: scaledCropGate.reason,
                            metrics: scaledCropGate.metrics,
                        });
                        detectionQuad = null;
                        finalScaledQuad = null;
                        throw new Error(`Unsafe auto-crop geometry: ${scaledCropGate.reason}`);
                    }

                    const norm = await normalizeCapturedDocument(
                        uprightUri,
                        scaledQuad,
                        uprightDims,
                        { cropProfile },
                    );
                    finalUri = norm.uri;
                    finalDims = { width: norm.width, height: norm.height };
                    finalScaledQuad = scaledQuad;
                } catch (e) {
                    finalScaledQuad = null;
                    cropConfidence = undefined;
                    console.warn('[commitCapture] perspective correction failed:', e);
                }
            }

            // Step 2b: Resize if perspective correction didn't run (only for single page mode)
            if (finalUri === uprightUri && useScanStore.getState().currentSession?.settings.page_mode !== 'double') {
                const isSlowNet = networkQuality === '2g' || networkQuality === '3g';
                const quality = isSlowNet ? (networkQuality === '2g' ? 0.72 : 0.80) : 0.90;
                const maxWidth = isSlowNet ? 1200 : 1600;

                const resized = await ImageManipulator.manipulateAsync(
                    finalUri,
                    [{ resize: { width: maxWidth } }],
                    { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
                );
                finalUri = resized.uri;
                finalDims = { width: resized.width, height: resized.height };
            }

            // CLEANUP: delete temporary canonical image and upright rotated image if they are not final
            try {
                if (canonicalUri !== finalUri && canonicalUri !== uprightUri) {
                    new File(canonicalUri).delete();
                }
            } catch (_) {}
            try {
                if (uprightUriToCleanup && uprightUriToCleanup !== finalUri) {
                    new File(uprightUriToCleanup).delete();
                }
            } catch (_) {}

            const stateAtSave = useScanStore.getState();
            // Use the page mode snapshotted at shutter-release (pending.pageMode) rather than
            // the live store value. This prevents the user tapping 1-page/2-page between
            // capture and processing from corrupting the output.
            let shouldSplitDoublePage =
                pending.pageMode === 'double' &&
                !stateAtSave.pendingRetake;

            // Normalize double-page source orientation before split.
            // normalizeDoublePageSource() ensures the image is landscape-oriented
            // (matching the open book) before we split left/right.
            // Without this call, a portrait-captured double-page spread gets split
            // top/bottom instead of left/right, producing garbage output.
            let splitSource = { uri: finalUri, width: finalDims.width, height: finalDims.height };
            if (pending.pageMode === 'double' && !stateAtSave.pendingRetake) {
                try {
                    const normalized = await normalizeDoublePageSource(
                        finalUri,
                        finalDims.width,
                        finalDims.height,
                        pending.captureOrientation,
                    );
                    splitSource = normalized;
                } catch (normErr) {
                    console.warn('[commitCapture] normalizeDoublePageSource failed, using original:', normErr);
                }
            }

            // Store diagnostics for each page part
            let partsDiagnostics: any[] = [];
            let singlePageCropQuad: Quadrilateral | null = null;
            let singlePageCropConfidence: number | undefined;
            let singlePageDetector: 'docquad' | 'opencv' | 'none' = 'none';
            let singlePageRejectedReason: string | undefined;

            let twoPagesRes: any = null;

            if (shouldSplitDoublePage) {
                // Determine if 2 pages are actually visible
                twoPagesRes = await checkIfTwoPagesVisible(splitSource.uri, splitSource.width, splitSource.height);
                if (!twoPagesRes.visible) {
                    console.log(`[CROP-DIAGNOSTICS] Only one page visible in double page mode. Skipping split. Reason: ${twoPagesRes.reason}`);
                    shouldSplitDoublePage = false;
                    singlePageCropQuad = twoPagesRes.quad || null;
                    singlePageCropConfidence = twoPagesRes.confidence;
                    singlePageDetector = twoPagesRes.detectorUsed;
                    singlePageRejectedReason = twoPagesRes.reason;
                }
            }

            const refineSequentialSplitParts = async (rawParts: PreparedImagePart[]) => {
                if (pending.autoCropEnabled) {
                    return await Promise.all(rawParts.map(async (part, idx) => {
                        const refined = await refineSplitPartCrop(part);
                        partsDiagnostics[idx] = {
                            detectorUsed: refined.cropApplied ? (refined.cropConfidence !== undefined ? 'docquad' : 'opencv') : 'none',
                            confidence: refined.cropConfidence || 0,
                            accepted: !!refined.cropApplied,
                            reason: refined.cropApplied ? undefined : 'Crop rejected or low confidence',
                            cropQuad: refined.cropQuad ? JSON.stringify(refined.cropQuad) : undefined,
                            outputSize: `${refined.width}x${refined.height}`,
                        };
                        return refined;
                    }));
                } else {
                    rawParts.forEach((part, idx) => {
                        partsDiagnostics[idx] = {
                            detectorUsed: 'none',
                            confidence: 0,
                            accepted: false,
                            reason: 'Auto-crop disabled',
                            outputSize: `${part.width}x${part.height}`,
                        };
                    });
                    return rawParts;
                }
            };

            let imageParts: PreparedImagePart[] = [];
            if (shouldSplitDoublePage) {
                const rawParts = await splitDoublePageImage(splitSource.uri, splitSource.width, splitSource.height);
                if (pending.autoCropEnabled && twoPagesRes.quad && twoPagesRes.detectorUsed !== 'none') {
                    console.log(`[commitCapture] Using optimized mathematical split of the full spread quad (${twoPagesRes.detectorUsed})`);
                    const isHorizontal = splitSource.width >= splitSource.height;
                    const splitQuads = splitQuadrilateral(twoPagesRes.quad, isHorizontal ? 'horizontal' : 'vertical');

                    let detectionDims = { width: splitSource.width, height: splitSource.height };
                    if (twoPagesRes.detectorUsed === 'opencv' && splitSource.width > POST_CAPTURE_DETECTION_WIDTH) {
                        detectionDims = {
                            width: POST_CAPTURE_DETECTION_WIDTH,
                            height: Math.round(splitSource.height * (POST_CAPTURE_DETECTION_WIDTH / splitSource.width))
                        };
                    }

                    const scaledLeftQuad = scaleQuadToDimensions(splitQuads.first, detectionDims, splitSource);
                    const scaledRightQuad = scaleQuadToDimensions(splitQuads.second, detectionDims, splitSource);

                    try {
                        const normLeft = await normalizeCapturedDocument(splitSource.uri, scaledLeftQuad, splitSource, {
                            cropProfile: twoPagesRes.detectorUsed === 'docquad' ? 'docquad' : 'standard',
                        });
                        const normRight = await normalizeCapturedDocument(splitSource.uri, scaledRightQuad, splitSource, {
                            cropProfile: twoPagesRes.detectorUsed === 'docquad' ? 'docquad' : 'standard',
                        });

                        const finalLeftQuad = adjustQuadForSplitOffset(
                            scaledLeftQuad,
                            rawParts[0].splitPart || 'left',
                            splitSource.width,
                            splitSource.height
                        );
                        const finalRightQuad = adjustQuadForSplitOffset(
                            scaledRightQuad,
                            rawParts[1].splitPart || 'right',
                            splitSource.width,
                            splitSource.height
                        );

                        imageParts = [
                            {
                                uri: normLeft.uri,
                                width: normLeft.width,
                                height: normLeft.height,
                                splitPart: rawParts[0].splitPart,
                                rawUri: rawParts[0].uri,
                                cropQuad: finalLeftQuad,
                                cropConfidence: twoPagesRes.confidence,
                                cropApplied: true,
                            },
                            {
                                uri: normRight.uri,
                                width: normRight.width,
                                height: normRight.height,
                                splitPart: rawParts[1].splitPart,
                                rawUri: rawParts[1].uri,
                                cropQuad: finalRightQuad,
                                cropConfidence: twoPagesRes.confidence,
                                cropApplied: true,
                            }
                        ];

                        partsDiagnostics[0] = {
                            detectorUsed: twoPagesRes.detectorUsed,
                            confidence: twoPagesRes.confidence || 0,
                            accepted: true,
                            cropQuad: JSON.stringify(finalLeftQuad),
                            outputSize: `${normLeft.width}x${normLeft.height}`,
                        };
                        partsDiagnostics[1] = {
                            detectorUsed: twoPagesRes.detectorUsed,
                            confidence: twoPagesRes.confidence || 0,
                            accepted: true,
                            cropQuad: JSON.stringify(finalRightQuad),
                            outputSize: `${normRight.width}x${normRight.height}`,
                        };
                    } catch (warpErr) {
                        console.warn('[commitCapture] Optimized warp failed, falling back to sequential split crop:', warpErr);
                        imageParts = await refineSequentialSplitParts(rawParts);
                    }
                } else {
                    imageParts = await refineSequentialSplitParts(rawParts);
                }
            } else {
                // Single page path (either from the beginning, or skipped split)
                let singlePart: PreparedImagePart = { uri: splitSource.uri, width: splitSource.width, height: splitSource.height };
                
                if (pending.autoCropEnabled) {
                    if (finalScaledQuad) {
                        // If we already cropped/normalized in Step 2, use the cropped image directly!
                        singlePart = {
                            uri: splitSource.uri,
                            width: splitSource.width,
                            height: splitSource.height,
                            cropQuad: finalScaledQuad,
                            cropConfidence: cropConfidence,
                            cropApplied: true
                        };
                        partsDiagnostics[0] = {
                            detectorUsed: cropProfile === 'docquad' ? 'docquad' : 'opencv',
                            confidence: cropConfidence || 0,
                            accepted: true,
                            cropQuad: JSON.stringify(finalScaledQuad),
                            outputSize: `${splitSource.width}x${splitSource.height}`,
                        };
                    } else {
                        // If auto-crop didn't run or failed in Step 2, check if checkIfTwoPagesVisible found a quad, or fallback
                        let detectionQ = singlePageCropQuad;
                        let cropConf = singlePageCropConfidence;
                        let detector = singlePageDetector;
                        
                        if (detectionQ) {
                            try {
                                const scaledQuad = scaleQuadToDimensions(detectionQ, splitSource, splitSource);
                                const gate = evaluateAutoCropCandidate(scaledQuad, splitSource, {
                                    confidence: cropConf,
                                    profile: detector === 'docquad' ? 'docquad' : 'standard',
                                });
                                
                                if (gate.accepted) {
                                    const norm = await normalizeCapturedDocument(splitSource.uri, scaledQuad, splitSource, {
                                        cropProfile: detector === 'docquad' ? 'docquad' : 'standard',
                                        isManualCrop: false
                                    });
                                    singlePart = {
                                        uri: norm.uri,
                                        width: norm.width,
                                        height: norm.height,
                                        cropQuad: scaledQuad,
                                        cropConfidence: cropConf,
                                        cropApplied: true
                                    };
                                    partsDiagnostics[0] = {
                                        detectorUsed: detector,
                                        confidence: cropConf || 0,
                                        accepted: true,
                                        cropQuad: JSON.stringify(scaledQuad),
                                        outputSize: `${norm.width}x${norm.height}`,
                                    };
                                } else {
                                    partsDiagnostics[0] = {
                                        detectorUsed: detector,
                                        confidence: cropConf || 0,
                                        accepted: false,
                                        reason: gate.reason || 'Rejected by candidate evaluation',
                                        cropQuad: JSON.stringify(scaledQuad),
                                        outputSize: `${splitSource.width}x${splitSource.height}`,
                                    };
                                }
                            } catch (err) {
                                console.warn('[commitCapture] Single part perspective correction failed:', err);
                                partsDiagnostics[0] = {
                                    detectorUsed: detector,
                                    confidence: cropConf || 0,
                                    accepted: false,
                                    reason: err instanceof Error ? err.message : String(err),
                                    outputSize: `${splitSource.width}x${splitSource.height}`,
                                };
                            }
                        } else {
                            partsDiagnostics[0] = {
                                detectorUsed: 'none',
                                confidence: 0,
                                accepted: false,
                                reason: singlePageRejectedReason || 'No document detected',
                                outputSize: `${splitSource.width}x${splitSource.height}`,
                            };
                        }
                    }
                } else {
                    partsDiagnostics[0] = {
                        detectorUsed: 'none',
                        confidence: 0,
                        accepted: false,
                        reason: 'Auto-crop disabled',
                        outputSize: `${splitSource.width}x${splitSource.height}`,
                    };
                }
                
                imageParts = [singlePart];
            }

            const didSplitDoublePage = imageParts.length > 1;
            const splitSourcePageId = didSplitDoublePage ? generateUUID() : undefined;

            const persistPagePart = async (part: PreparedImagePart, index: number) => {
                const oriented = await autoOrientPageImage(
                    part.uri,
                    part.width,
                    part.height
                );

                const suffix = `${Date.now()}_${index}`;
                const origFilename = `orig_${suffix}.jpg`;
                const destOrig = new File(Paths.document, origFilename);
                new File(oriented.uri).copy(destOrig);

                let origVerified = false;
                for (let i = 0; i < 10; i++) {
                    if (destOrig.exists) { origVerified = true; break; }
                    await new Promise(r => setTimeout(r, 50));
                }
                if (!origVerified) {
                    throw new Error('Failed to save original page image');
                }

                const isSlowNet = networkQuality === '2g' || networkQuality === '3g';
                const quality = isSlowNet ? (networkQuality === '2g' ? 0.72 : 0.80) : 0.88;
                const maxWidth = isSlowNet ? 1200 : 1600;

                const filteredUri = await applyFilter(destOrig.uri, filter, {
                    compress: quality,
                    maxWidth: maxWidth
                });

                const filename = `scanned_${suffix}.jpg`;
                const dest = new File(Paths.document, filename);
                new File(filteredUri).copy(dest);

                let verified = false;
                for (let i = 0; i < 10; i++) {
                    if (dest.exists) { verified = true; break; }
                    await new Promise(r => setTimeout(r, 50));
                }
                if (!verified) {
                    throw new Error('Failed to save filtered page image');
                }

                const cropAttempted = pending.autoCropEnabled;
                const cropFailed = cropAttempted && !part.cropApplied;
                const needsOrientationOrCropReview = oriented.needsReview || cropFailed;

                let rawPath: string | undefined = undefined;
                if (didSplitDoublePage) {
                    if (part.rawUri) {
                        const rawFilename = `raw_${suffix}.jpg`;
                        const destRawSplit = new File(Paths.document, rawFilename);
                        new File(part.rawUri).copy(destRawSplit);
                        let rawVerifiedSplit = false;
                        for (let i = 0; i < 10; i++) {
                            if (destRawSplit.exists) { rawVerifiedSplit = true; break; }
                            await new Promise(r => setTimeout(r, 50));
                        }
                        if (rawVerifiedSplit) {
                            rawPath = destRawSplit.uri;
                        }
                    }
                } else {
                    if (rawVerified) {
                        rawPath = destRaw.uri;
                    }
                }

                const page: ScannedPage = {
                    id: generateUUID(),
                    ui_id: '',
                    page_number: 0,
                    file_path: dest.uri,
                    original_file_path: destOrig.uri,
                    raw_file_path: rawPath,
                    crop_quad: part.cropQuad || undefined,
                    crop_applied: !!part.cropApplied,
                    crop_confidence: part.cropConfidence,
                    orientation_degrees: oriented.orientationDegrees,
                    needs_orientation_review: needsOrientationOrCropReview,
                    split_source_page_id: splitSourcePageId,
                    split_part: part.splitPart,
                    filter_mode: filter,
                    file_size: dest.size || 0,
                    is_blurry: pending.blur.isBlurry,
                    sharpness_score: pending.blur.sharpnessScore,
                    captured_at: new Date().toISOString(),
                    diagnostics: partsDiagnostics[index],
                };

                // Pass the phase and studentIndex snapshotted at shutter-release time so that
                // any UI changes the user made during processing do not redirect this page.
                addPageRef.current(page, pending.phase, pending.studentIndex);
            };

            for (let i = 0; i < imageParts.length; i++) {
                await persistPagePart(imageParts[i], i);
            }
        } catch (e) {
            console.warn('[commitCapture] error:', e);
            Sentry.captureException(e, { tags: { area: 'commitCapture' } });
        } finally {
            normalizingRef.current = false;
        }
    }, []);

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

    const handleTogglePageMode = useCallback(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        useScanStore.setState(state => {
            const session = state.currentSession;
            if (!session) return {};
            const nextMode: 'single' | 'double' = session.settings.page_mode === 'double' ? 'single' : 'double';
            const updatedSession = {
                ...session,
                settings: {
                    ...session.settings,
                    page_mode: nextMode,
                },
            };
            return {
                currentSession: updatedSession,
                savedSessions: state.savedSessions.map(saved =>
                    saved.session_id === updatedSession.session_id ? updatedSession : saved
                ),
            };
        });
        resetScannerState();
    }, []);

    const handleNextStudent = useCallback(() => {
        silentNextStudent();
        resetScannerState();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [silentNextStudent]);

    const handlePickPdf = useCallback(async () => {
        try {
            setIsPaused(true);
            isPausedRef.current = true;
            resetScannerState();

            const result = await DocumentPicker.getDocumentAsync({
                type: 'application/pdf',
                multiple: currentPhase === 'students',
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets?.length) {
                return;
            }

            const selectedAssets = currentPhase === 'students'
                ? result.assets
                : result.assets.slice(0, 1);

            if (currentPhase !== 'students' && result.assets.length > 1) {
                Alert.alert('One PDF added', 'This step accepts one document. The first selected PDF was added.');
            }

            for (let index = 0; index < selectedAssets.length; index += 1) {
                const store = useScanStore.getState();
                if (currentPhase === 'students') {
                    const activeStudent = store.currentSession?.students[store.currentStudentIndex];
                    const activeStudentHasPages = Boolean(activeStudent?.pages?.length);
                    if (index > 0 || activeStudentHasPages) {
                        store.silentNextStudent();
                    }
                }
                useScanStore.getState().addPage(createImportedPdfPage(selectedAssets[index], generateUUID));
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Please choose a valid PDF and try again.';
            Alert.alert('Could not add PDF', message);
        }
    }, [currentPhase]);

    const returnToUploadScreen = useCallback(() => {
        const activeSession = useScanStore.getState().currentSession;
        const targetSessionId = activeSession?.session_id || sessionId;
        saveSession();

        if (targetSessionId) {
            router.replace({
                pathname: '/upload',
                params: {
                    sessionId: targetSessionId,
                    documentMode: '1',
                },
            });
        } else {
            router.replace('/(tabs)/sessions');
        }
    }, [router, saveSession, sessionId]);

    const handleSmartScan = useCallback(async () => {
        if (isNativeScanning) return;

        try {
            setIsNativeScanning(true);
            setIsPaused(true);
            isPausedRef.current = true;
            resetScannerState();

            const response = await DocumentScanner.scanDocument({
                croppedImageQuality: 100,
                responseType: ResponseType.ImageFilePath,
                ...(currentPhase !== 'students' ? { maxNumDocuments: 1 } : {}),
            });

            const scannedImages = response.scannedImages || [];
            if (response.status === ScanDocumentResponseStatus.Cancel || scannedImages.length === 0) {
                return;
            }

            const selectedImages = currentPhase === 'students' ? scannedImages : scannedImages.slice(0, 1);
            if (currentPhase !== 'students' && scannedImages.length > 1) {
                Alert.alert('One page added', 'This step accepts one document. The first scanned page was added.');
            }

            for (let index = 0; index < selectedImages.length; index += 1) {
                const store = useScanStore.getState();
                if (currentPhase === 'students') {
                    const activeStudent = store.currentSession?.students[store.currentStudentIndex];
                    const activeStudentHasPages = Boolean(activeStudent?.pages?.length);
                    if (index > 0 || activeStudentHasPages) {
                        store.silentNextStudent();
                    }
                }
                const page = await createNativeScannedImagePage(selectedImages[index], generateUUID, index);
                useScanStore.getState().addPage(page);
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            if (shouldLaunchNativeScanner && shouldReturnToUpload) {
                returnToUploadScreen();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Native document scanner could not finish this scan.';
            Alert.alert('Smart Scan unavailable', `${message}\n\nYou can continue with the camera scanner.`);
        } finally {
            if (isMounted.current) {
                setIsNativeScanning(false);
                setIsPaused(false);
            }
            isPausedRef.current = false;
        }
    }, [currentPhase, isNativeScanning, returnToUploadScreen, shouldLaunchNativeScanner, shouldReturnToUpload]);

    useEffect(() => {
        if (!shouldLaunchNativeScanner || nativeScannerLaunchedRef.current || !permission?.granted) return;
        nativeScannerLaunchedRef.current = true;
        handleSmartScan();
    }, [handleSmartScan, permission?.granted, shouldLaunchNativeScanner]);

    const handleFinishPhase = useCallback(() => {
        const session = useScanStore.getState().currentSession;
        if (!session) return;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (shouldReturnToUpload) {
            returnToUploadScreen();
            return;
        }

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
    }, [currentPhase, returnToUploadScreen, shouldReturnToUpload]);

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
                pageMode={pageMode}
                isLandscape={false}
                onTogglePageMode={handleTogglePageMode}
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

                {/* Floating Network Indicator */}
                <View 
                    style={[
                        styles.floatingNetworkIndicator, 
                        { 
                            top: insets.top + 60,
                            backgroundColor: networkQuality === 'offline' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0,0,0,0.5)'
                        }
                    ]} 
                >
                    <View 
                        style={[
                            styles.networkDot, 
                            { 
                                backgroundColor: 
                                    networkQuality === 'wifi_4g' ? '#10B981' :
                                    networkQuality === '3g' ? '#F59E0B' :
                                    networkQuality === '2g' ? '#EF4444' :
                                    '#9CA3AF'
                            }
                        ]} 
                    />
                    <Text style={styles.networkText}>
                        {networkQuality === 'wifi_4g' ? 'WiFi/4G' :
                         networkQuality === '3g' ? '3G' :
                         networkQuality === '2g' ? '2G' :
                         'Offline'}
                    </Text>
                </View>

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
                                {isPdfScannedPage(item) ? (
                                    <View style={[styles.thumbImage, styles.pdfThumb]}>
                                        <Ionicons name="document-text" size={22} color="#fff" />
                                    </View>
                                ) : (
                                    <Image
                                        source={{ uri: item.file_path }}
                                        style={styles.thumbImage}
                                        contentFit="cover"
                                    />
                                )}
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
                pageMode={pageMode}
                stabilityProgress={stabilityProgress}
                onTogglePause={handleTogglePause}
                onTogglePageMode={handleTogglePageMode}
                onManualCapture={handleManualCapture}
                onPickPdf={handlePickPdf}
                onSmartScan={handleSmartScan}
                onNextStudent={handleNextStudent}
                onUndo={undoLastPage}
                onFinishPhase={handleFinishPhase}
                onFinishSession={() => {
                    if (shouldReturnToUpload) {
                        returnToUploadScreen();
                    } else {
                        saveSession();
                        router.replace('/review');
                    }
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
    floatingNetworkIndicator: {
        position: 'absolute',
        right: 74,
        height: 44,
        borderRadius: 22,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        gap: 6,
        zIndex: 10,
    },
    networkDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    networkText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
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
    pdfThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(235,87,34,0.38)' },
    blurDot: { position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E24B4A' },
});
