import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import { OpenCV, ObjectType, DataTypes } from 'react-native-fast-opencv';
import { Point, Quadrilateral, cleanupMats } from './cvProcessor';
import { evaluateAutoCropCandidate } from './cropQuality';

export interface NormalizationOptions {
  enhancementMode?: 'original' | 'enhanced_color' | 'grayscale';
  debugMode?: boolean;
  isManualCrop?: boolean;
}

const ENABLE_MANUAL_CROP_EXACT_EXPORT = true;

export interface NormalizationResult {
  uri: string;
  width: number;
  height: number;
}

const TARGET_MAX_HEIGHT = 2048;
const OUTPUT_LONG_SIDE = 2048;
const MIN_OUTPUT_SIDE = 960;
const MIN_PAGE_ASPECT = 0.55;
const MAX_PAGE_ASPECT = 1.65;
const CROP_PADDING_RATIO = 0.03; // 3% padding

/**
 * Order corners deterministically: Top-Left, Top-Right, Bottom-Right, Bottom-Left
 * using Sum/Difference method for robust skew/rotation handling.
 */
function orderCorners(pts: Point[]): Quadrilateral {
  const sums = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.y - p.x);

  const tlIdx = sums.indexOf(Math.min(...sums));
  const brIdx = sums.indexOf(Math.max(...sums));

  const trIdx = diffs.indexOf(Math.min(...diffs));
  const blIdx = diffs.indexOf(Math.max(...diffs));

  return {
    topLeft: pts[tlIdx],
    topRight: pts[trIdx],
    bottomRight: pts[brIdx],
    bottomLeft: pts[blIdx]
  };
}

/**
 * Expand the quadrilateral outwards by a padding ratio to prevent tight cropping.
 */
function expandQuad(quad: Quadrilateral, width: number, height: number, ratio: number): Quadrilateral {
  const center = {
    x: (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4,
    y: (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4
  };

  const expandPoint = (p: Point): Point => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
      x: Math.max(0, Math.min(width, center.x + dx * (1 + ratio))),
      y: Math.max(0, Math.min(height, center.y + dy * (1 + ratio)))
    };
  };

  return {
    topLeft: expandPoint(quad.topLeft),
    topRight: expandPoint(quad.topRight),
    bottomRight: expandPoint(quad.bottomRight),
    bottomLeft: expandPoint(quad.bottomLeft)
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeWarpDimensions(quad: Quadrilateral): { width: number; height: number } {
  const topWidth = distance(quad.topLeft, quad.topRight);
  const bottomWidth = distance(quad.bottomLeft, quad.bottomRight);
  const leftHeight = distance(quad.topLeft, quad.bottomLeft);
  const rightHeight = distance(quad.topRight, quad.bottomRight);
  const estimatedWidth = Math.max(topWidth, bottomWidth, 1);
  const estimatedHeight = Math.max(leftHeight, rightHeight, 1);
  const aspect = clamp(estimatedWidth / estimatedHeight, MIN_PAGE_ASPECT, MAX_PAGE_ASPECT);

  if (aspect >= 1) {
    return {
      width: OUTPUT_LONG_SIDE,
      height: Math.max(MIN_OUTPUT_SIDE, Math.round(OUTPUT_LONG_SIDE / aspect)),
    };
  }

  return {
    width: Math.max(MIN_OUTPUT_SIDE, Math.round(OUTPUT_LONG_SIDE * aspect)),
    height: OUTPUT_LONG_SIDE,
  };
}

/**
 * Normalizes a captured document image via a Hybrid Pipeline:
 * 1. Native downscale using ImageManipulator (Memory safety)
 * 2. Base64 conversion + OpenCV Mat loading
 * 3. Perspective Warp + Smart Crop
 * 4. Safe memory cleanup
 */
export async function normalizeCapturedDocument(
  rawImageUri: string,
  rawQuad: Quadrilateral,
  originalBitmapDimensions: { width: number, height: number },
  options: NormalizationOptions = {}
): Promise<NormalizationResult> {
  console.log('[CV-AUDIT] normalizeCapturedDocument entry', {
      rawWidth: originalBitmapDimensions.width,
      rawHeight: originalBitmapDimensions.height,
      cropQuad: rawQuad,
  });

  let downscaledUri: string | null = null;
  let finalUri: string | null = null;

  // Mats and buffers for cleanup
  let srcMat: any = null;
  let resizedMat: any = null;
  let dstMat: any = null;
  let transformMat: any = null;
  let enhancedMat: any = null;

  try {
    const tStart = performance.now();
    const tLoadStart = performance.now();

    const base64 = await FileSystem.readAsStringAsync(rawImageUri, {
      encoding: 'base64',
    });

    srcMat = OpenCV.base64ToMat(base64);

    const tImread = performance.now() - tLoadStart;

    if (!srcMat || srcMat.cols <= 0 || srcMat.rows <= 0) {
      throw new Error(`imread returned empty Mat`);
    }

    const { width: rawWidth, height: rawHeight } = originalBitmapDimensions;

    // STEP 1.5: Hard Validation Guards
    if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
      throw new Error(`[normalizeCapturedDocument] Invalid bitmap dimensions: ${rawWidth}x${rawHeight}`);
    }

    if (__DEV__) {
      console.log(`[DEBUG-NORMALIZE] Original image dimensions (from capture): ${rawWidth}x${rawHeight}`);
    }

    // ── STEP 2: Native Resize ───────────────────────────────────────────
    const tNativeResizeStart = performance.now();
    const aspectRatio = rawWidth / rawHeight;
    let targetWidth = rawWidth;
    let targetHeight = rawHeight;

    if (rawHeight > TARGET_MAX_HEIGHT) {
      targetHeight = TARGET_MAX_HEIGHT;
      targetWidth = Math.round(TARGET_MAX_HEIGHT * Math.max(0.01, aspectRatio));

      if (__DEV__) {
        console.log(`[DEBUG-NORMALIZE] Resized dimensions: ${targetWidth}x${targetHeight}`);
      }

      resizedMat = OpenCV.createObject(ObjectType.Mat, targetHeight, targetWidth, DataTypes.CV_8UC3);
      const dsize = OpenCV.createObject(ObjectType.Size, targetWidth, targetHeight);
      // 1 = INTER_LINEAR
      (OpenCV as any).invoke('resize', srcMat, resizedMat, dsize, 0, 0, 1);
    } else {
      resizedMat = srcMat;
      if (__DEV__) {
        console.log(`[DEBUG-NORMALIZE] Skipping resize, image within target bounds: ${targetWidth}x${targetHeight}`);
      }
    }
    const tResize = performance.now() - tNativeResizeStart;

    // ── STEP 3: Scale Quadrilateral ─────────────────────────────────────
    // rawQuad is relative to originalBitmapDimensions. We scale it 
    // to the new target dimensions.
    const scaleX = targetWidth / rawWidth;
    const scaleY = targetHeight / rawHeight;

    const scalePoint = (p: Point): Point => ({ x: p.x * scaleX, y: p.y * scaleY });

    const scaledQuad: Quadrilateral = {
      topLeft: scalePoint(rawQuad.topLeft),
      topRight: scalePoint(rawQuad.topRight),
      bottomRight: scalePoint(rawQuad.bottomRight),
      bottomLeft: scalePoint(rawQuad.bottomLeft),
    };

    // Order corners deterministically, unless manual crop explicitly overrides
    const orderedQuad = (options.isManualCrop && ENABLE_MANUAL_CROP_EXACT_EXPORT) ? scaledQuad : orderCorners([
      scaledQuad.topLeft,
      scaledQuad.topRight,
      scaledQuad.bottomRight,
      scaledQuad.bottomLeft
    ]);

    if (!options.isManualCrop) {
      const cropGate = evaluateAutoCropCandidate(orderedQuad, { width: targetWidth, height: targetHeight });
      if (!cropGate.accepted) {
        throw new Error(`[normalizeCapturedDocument] Unsafe auto-crop geometry: ${cropGate.reason}`);
      }
    }

    // Apply smart crop padding, unless manual crop explicitly overrides
    const expandedQuad = (options.isManualCrop && ENABLE_MANUAL_CROP_EXACT_EXPORT) ? orderedQuad : expandQuad(orderedQuad, targetWidth, targetHeight, CROP_PADDING_RATIO);
    const warpSize = computeWarpDimensions(expandedQuad);

    // ── STEP 4: Perspective Warp ─────────────────────────────────────────
    // Source points
    const srcPoints = [
      OpenCV.createObject(ObjectType.Point2f, expandedQuad.topLeft.x, expandedQuad.topLeft.y),
      OpenCV.createObject(ObjectType.Point2f, expandedQuad.topRight.x, expandedQuad.topRight.y),
      OpenCV.createObject(ObjectType.Point2f, expandedQuad.bottomRight.x, expandedQuad.bottomRight.y),
      OpenCV.createObject(ObjectType.Point2f, expandedQuad.bottomLeft.x, expandedQuad.bottomLeft.y)
    ];
    const srcVector = OpenCV.createObject(ObjectType.Point2fVector, srcPoints);

    // Destination points (flattened rectangle)
    const dstPoints = [
      OpenCV.createObject(ObjectType.Point2f, 0, 0),
      OpenCV.createObject(ObjectType.Point2f, warpSize.width, 0),
      OpenCV.createObject(ObjectType.Point2f, warpSize.width, warpSize.height),
      OpenCV.createObject(ObjectType.Point2f, 0, warpSize.height)
    ];
    const dstVector = OpenCV.createObject(ObjectType.Point2fVector, dstPoints);

    // Get Transform Matrix (0 = DECOMP_LU)
    transformMat = (OpenCV as any).invoke('getPerspectiveTransform', srcVector, dstVector, 0);

    const tWarpStart = performance.now();
    // Warp
    dstMat = OpenCV.createObject(ObjectType.Mat, warpSize.height, warpSize.width, DataTypes.CV_8UC3);
    const dsize = OpenCV.createObject(ObjectType.Size, warpSize.width, warpSize.height);
    // 1 = INTER_LINEAR, 0 = BORDER_CONSTANT
    const scalar0 = OpenCV.createObject(ObjectType.Scalar, 0, 0, 0);
    (OpenCV as any).invoke('warpPerspective', resizedMat, dstMat, transformMat, dsize, 1, 0, scalar0);
    const tWarp = performance.now() - tWarpStart;

    // ── STEP 5: Image Enhancement ────────────────────────────────────────
    let finalProcessingMat = dstMat;

    if (options.enhancementMode === 'grayscale') {
      enhancedMat = OpenCV.createObject(ObjectType.Mat, warpSize.height, warpSize.width, DataTypes.CV_8UC1);
      (OpenCV as any).invoke('cvtColor', dstMat, enhancedMat, 6); // COLOR_RGBA2GRAY
      finalProcessingMat = enhancedMat;
    } else if (options.enhancementMode === 'enhanced_color' || !options.enhancementMode) {
      // Basic sharpening fallback: unsharp mask or Laplacian could be used. 
      // For now, we return the warped RGB as 'enhanced' to maintain safety.
      // (Advanced OpenCV color balancing is risky in this constrained environment).
      finalProcessingMat = dstMat;
    }

    // ── STEP 6: Save Normalized Output ───────────────────────────────────
    const outFilename = `normalized_${Date.now()}.jpg`;
    // Use new class-based API: Paths.cache is the safe cache directory
    const outFile = new File(Paths.cache, outFilename);
    finalUri = outFile.uri;

    // Save directly from Native Mat to File (avoids Base64 output serialization!)
    const tSaveStart = performance.now();
    OpenCV.saveMatToFile(finalProcessingMat, finalUri, 'jpeg', 0.9);
    const tSave = performance.now() - tSaveStart;

    const tTotal = performance.now() - tStart;
    console.log(`[TIMING] normalizeCapturedDocument: Total=${tTotal.toFixed(1)}ms (resize=${tResize.toFixed(1)}ms, imread=${tImread.toFixed(1)}ms, warp=${tWarp.toFixed(1)}ms, save=${tSave.toFixed(1)}ms)`);

    // Wait slightly to ensure filesystem flush
    await new Promise(resolve => setTimeout(resolve, 50));

    return {
      uri: finalUri,
      width: warpSize.width,
      height: warpSize.height
    };

  } finally {
    // ── STEP 7: Aggressive Memory Cleanup ────────────────────────────────
    cleanupMats([srcMat, resizedMat !== srcMat ? resizedMat : null, dstMat, transformMat, enhancedMat]);

    try {
      OpenCV.clearBuffers();
    } catch { /* ignore */ }
  }
}
