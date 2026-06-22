import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import { OpenCV, ObjectType, DataTypes } from 'react-native-fast-opencv';
import { evaluateAutoCropCandidate } from './cropQuality';
import { refineQuadWithBoundaryPoints } from './documentBoundary';

export interface CVProcessingResult {
  isDocumentDetected: boolean;
  sharpnessScore: number;
  motionLevel: number;
  isStable: boolean;
  quadrilateral: null | Quadrilateral;
  dimensions?: { width: number; height: number };
  captureReadiness: number; // 0-100 score
  confidence: number;
  areaScore: number;
  rectangularityScore: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Quadrilateral {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

// OpenCV Constants (from library documentation/headers)
const COLOR_RGBA2GRAY = 6;
const GAUSSIAN_BLUR = 'GaussianBlur';
const CANNY = 'Canny';
const FIND_CONTOURS = 'findContours';
const RETR_EXTERNAL = 0;
const RETR_LIST = 1;
const CHAIN_APPROX_SIMPLE = 2;

// Feature Flags for Stabilization
const ENABLE_CENTROID_ORDERING = true;
const ENABLE_EMA_SMOOTHING = true;
const ENABLE_ADAPTIVE_LIGHTING = true;
const ENABLE_RELAXED_SCORING = true;

let lastPoints: Point[] = [];
let lastStablePoints: Point[] | null = null;
let stabilityCounter = 0;
let globalAvgBrightness = 127;
const EMA_ALPHA = 0.15;
const EMA_DRIFT_THRESHOLD = 30; // pixels

export function resetScannerState() {
  lastPoints = [];
  lastStablePoints = null;
  stabilityCounter = 0;
  globalAvgBrightness = 127;
  if (__DEV__) console.log('[CV] Scanner state reset.');
}

/** Safe fallback returned whenever input is invalid or CV throws */
const SAFE_NO_DETECT_RESULT: CVProcessingResult = {
  isDocumentDetected: false,
  sharpnessScore: 0,
  motionLevel: 0,
  isStable: false,
  quadrilateral: null,
  captureReadiness: 0,
  confidence: 0,
  areaScore: 0,
  rectangularityScore: 0,
};

/**
 * Safely delete a list of OpenCV mat objects, ignoring any per-mat cleanup errors.
 * Call this in every early-return error path to prevent memory accumulation.
 */
export const cleanupMats = (mats: any[]): void => {
  mats.forEach(mat => {
    try {
      if (mat?.delete) mat.delete();
    } catch { /* ignore per-mat cleanup errors */ }
  });
};



/**
 * Real-time document detection using native OpenCV via JSI.
 * NEVER throws to callers — always returns a valid CVProcessingResult.
 * Each stage is isolated in its own try/catch for precise fault isolation.
 */
export async function detectDocumentInFrame(
  imageUri: string,
  width: number,
  height: number
): Promise<CVProcessingResult> {
  const tStart = performance.now();
  let tImread = 0;
  let tContour = 0;

  // ── INPUT GUARDS ─────────────────────────────────────────────────────────
  if (!imageUri || typeof imageUri !== 'string') {
    console.warn('[CV] detectDocumentInFrame: invalid URI input — returning safe default');
    return { ...SAFE_NO_DETECT_RESULT };
  }
  if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    console.warn('[CV] detectDocumentInFrame: invalid dimensions — returning safe default');
    return { ...SAFE_NO_DETECT_RESULT };
  }
  // ─────────────────────────────────────────────────────────────────────────
  // Declare all mats upfront so cleanup is always reachable
  let srcMat: any = null;
  let normalizedMat: any = null;
  let grayMat: any = null;
  let lapMat: any = null;
  let meanMat: any = null;
  let stddevMat: any = null;
  let blurMat: any = null;
  let ksizeMat: any = null;
  let edgeMat: any = null;
  let ctrData: any = null;

  /** Cleanup all allocated mats + clear OpenCV buffer pool */
  let hsvMat: any = null;
  let maskMat: any = null;
  let kernelMat: any = null;
  let maskedEdgeMat: any = null;
  let lowerBound: any = null;
  let upperBound: any = null;
  let dilatedEdgeMat: any = null;
  let closedEdgeMat: any = null;
  let edgeKernel5: any = null;
  let edgeKernel9: any = null;
  let maskCtrData: any = null;

  const safeCleanup = () => {
    cleanupMats([
      srcMat, normalizedMat, grayMat, lapMat, meanMat, stddevMat,
      blurMat, ksizeMat, edgeMat, ctrData,
      hsvMat, maskMat, kernelMat, maskedEdgeMat, lowerBound, upperBound,
      dilatedEdgeMat, closedEdgeMat, edgeKernel5, edgeKernel9, maskCtrData
    ]);
    try { OpenCV.clearBuffers(); } catch { /* ignore */ }
  };

  // ── STAGE 1: File → Mat ─────────────────────────────────────────────────────────
  try {
    const tLoadStart = performance.now();

    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    srcMat = OpenCV.base64ToMat(base64);

    tImread = performance.now() - tLoadStart;

    // Check if imread failed
    if (!srcMat || srcMat.cols <= 0 || srcMat.rows <= 0) {
      throw new Error(`imread returned empty Mat`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:imread]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── CANONICAL COLOR-SPACE NORMALIZATION ──────────────────────────────────────────
  try {
    // Probe the input image channel structure by calling matToBuffer metadata retrieval.
    const meta = OpenCV.matToBuffer(srcMat, 'uint8');
    const srcChannels = meta.channels;

    // We want our canonical format to be 4-channel RGBA.
    if (srcChannels === 4) {
      // 4 channels: could be RGBA or BGRA. Let's verify which grayscale conversion works.
      // COLOR_RGBA2GRAY = 11, COLOR_BGRA2GRAY = 10, COLOR_RGBA2BGRA = 5
      // To establish a deterministic RGBA format, we attempt to convert srcMat using COLOR_BGRA2RGBA (5)
      // or fall back to copying/keeping the original if that throws or if it's already RGBA.
      // If COLOR_RGBA2GRAY works but COLOR_BGRA2GRAY throws, it's RGBA. If both work or COLOR_BGRA2GRAY is preferred,
      // we check compatibility. Let's do a safe try-convert.
      normalizedMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC4);
      try {
        // Try assuming it is BGRA and convert to RGBA.
        // COLOR_BGRA2RGBA = 5 (which is the same enum value as COLOR_RGBA2BGRA in react-native-fast-opencv)
        (OpenCV as any).invoke('cvtColor', srcMat, normalizedMat, 5);
      } catch {
        // If conversion fails, copy it directly.
        (OpenCV as any).invoke('copyTo', srcMat, normalizedMat, srcMat);
      }
    } else if (srcChannels === 3) {
      // 3 channels: convert RGB/BGR to RGBA
      normalizedMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC4);
      try {
        // Try assuming it is BGR and convert to RGBA.
        // COLOR_BGR2RGBA = 2
        (OpenCV as any).invoke('cvtColor', srcMat, normalizedMat, 2);
      } catch {
        try {
          // Fallback: COLOR_RGB2RGBA = 0 (same as COLOR_BGR2BGRA in react-native-fast-opencv constants)
          (OpenCV as any).invoke('cvtColor', srcMat, normalizedMat, 0);
        } catch {
          // Last resort fallback
          (OpenCV as any).invoke('copyTo', srcMat, normalizedMat, srcMat);
        }
      }
    } else {
      // Monochromatic or other formats: fallback to copy
      normalizedMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC4);
      (OpenCV as any).invoke('copyTo', srcMat, normalizedMat, srcMat);
    }

    if (__DEV__) {
      const normMeta = OpenCV.matToBuffer(normalizedMat, 'uint8');
      console.log('[CV COLOR NORMALIZATION]', {
        srcChannels,
        normalizedChannels: normMeta.channels,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:normalization]', msg);
    // Fall back to srcMat if normalization fails entirely
    normalizedMat = srcMat;
  }

  // ── STAGE 2: Grayscale conversion ────────────────────────────────────────────────
  try {
    grayMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    // Since normalizedMat is guaranteed to be 4-channel RGBA, we use COLOR_RGBA2GRAY (11)
    (OpenCV as any).invoke('cvtColor', normalizedMat, grayMat, 11);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:grayscale]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 2.5: Frame Brightness Check ──────────────────────────────────────────
  try {
    if (ENABLE_ADAPTIVE_LIGHTING) {
      const meanGrayMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      const stddevGrayMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      (OpenCV as any).invoke('meanStdDev', grayMat, meanGrayMat, stddevGrayMat);
      const meanRaw: any = OpenCV.toJSValue(meanGrayMat);
      const frameMean = Array.isArray(meanRaw?.array) ? meanRaw.array[0] : 127;

      // Smooth the brightness to avoid rapid flickers
      globalAvgBrightness = globalAvgBrightness * 0.9 + frameMean * 0.1;

      cleanupMats([meanGrayMat, stddevGrayMat]);
    }
  } catch (err) {
    console.warn('[CV][STAGE:brightness]', err);
  }

  // ── STAGE 3: Sharpness — try OpenCV Laplacian, fall back to entropy heuristic ──
  let sharpnessScore = 0;
  try {
    lapMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('Laplacian', grayMat, lapMat, 3, 1, 1, 0, 4);
    meanMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    stddevMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    (OpenCV as any).invoke('meanStdDev', lapMat, meanMat, stddevMat);
    const stddevRaw: any = OpenCV.toJSValue(stddevMat);
    const stddevArr: any = stddevRaw?.array || stddevRaw;
    const laplacianScore = Math.pow(Array.isArray(stddevArr) ? stddevArr[0] : 0, 2);
    if (laplacianScore > 0) sharpnessScore = laplacianScore;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CV][STAGE:sharpness] OpenCV failed, using entropy fallback:', msg);
  } finally {
    cleanupMats([lapMat, meanMat, stddevMat]);
    lapMat = null; meanMat = null; stddevMat = null;
  }

  // Pure-JS entropy fallback
  if (sharpnessScore === 0) {
    // Cannot use bpp without base64 or file size. We could stat the file,
    // but that adds async overhead. For now, we will assign a synthetic score.
    sharpnessScore = 20;
    if (__DEV__) {
      console.log(`[CV SHARPNESS] (entropy disabled) synthetic score=${sharpnessScore}`);
    }
  }

  // ── STAGE 4: Gaussian blur ───────────────────────────────────────────────────
  try {
    blurMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    ksizeMat = OpenCV.createObject(ObjectType.Size, 5, 5);
    (OpenCV as any).invoke(GAUSSIAN_BLUR, grayMat, blurMat, ksizeMat, 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:blur]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 5: Canny edge detection ───────────────────────────────────────────
  try {
    edgeMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    let cannyLow = 30;
    let cannyHigh = 100;
    if (ENABLE_ADAPTIVE_LIGHTING) {
      cannyLow = Math.max(10, Math.round(globalAvgBrightness * 0.3));
      cannyHigh = Math.max(50, Math.round(globalAvgBrightness * 0.8));
    }
    (OpenCV as any).invoke(CANNY, blurMat, edgeMat, cannyLow, cannyHigh);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:canny]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 5.1: HSV Masking ───────────────────────────────────────────
  try {
    hsvMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC3);
    // Since normalizedMat is guaranteed to be 4-channel RGBA, we use COLOR_RGBA2BGR (3) or COLOR_RGB2HSV (41)
    // We first convert RGBA to 3-channel RGB (COLOR_RGBA2RGB = 1 / COLOR_BGRA2BGR = 4/1 equivalents)
    // and then convert to HSV, or convert RGBA directly to RGB first then RGB to HSV.
    // Let's do it cleanly:
    const tempRgbMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC3);
    (OpenCV as any).invoke('cvtColor', normalizedMat, tempRgbMat, 4); // COLOR_RGBA2RGB = 4 (actually COLOR_BGRA2RGB = COLOR_RGBA2BGR = 3, and COLOR_RGBA2RGB = 1 in react-native-fast-opencv constants: COLOR_RGBA2RGB is 1, COLOR_BGRA2RGB is 3)
    // Let's use exact code values:
    // COLOR_RGBA2RGB = 1
    // COLOR_RGB2HSV = 41
    (OpenCV as any).invoke('cvtColor', normalizedMat, tempRgbMat, 1);
    (OpenCV as any).invoke('cvtColor', tempRgbMat, hsvMat, 41);
    cleanupMats([tempRgbMat]);

    let vLower = 80;
    if (ENABLE_ADAPTIVE_LIGHTING) {
      // If global brightness is low, V threshold drops to allow dark paper.
      vLower = Math.max(20, Math.min(100, Math.round(globalAvgBrightness - 40)));
    }

    maskMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    lowerBound = OpenCV.createObject(ObjectType.Scalar, 0, 0, vLower);
    upperBound = OpenCV.createObject(ObjectType.Scalar, 179, 120, 255);
    (OpenCV as any).invoke('inRange', hsvMat, lowerBound, upperBound, maskMat);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:hsvMask]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 5.2: Mask Morphology (MORPH_CLOSE) ──────────────────────────
  try {
    const ksize = OpenCV.createObject(ObjectType.Size, 9, 9);
    kernelMat = (OpenCV as any).invoke('getStructuringElement', 0, ksize); // MORPH_RECT = 0
    (OpenCV as any).invoke('morphologyEx', maskMat, maskMat, 3, kernelMat); // MORPH_CLOSE = 3

    if (__DEV__) {
      // DEBUG: save mask to disk
      const maskFile = new File(Paths.cache, `debug_mask_${Date.now()}.jpg`);
      OpenCV.saveMatToFile(maskMat, maskFile.uri, 'jpeg', 0.9);
      console.log(`[DEBUG-AUTOCROP] Saved Mask: ${maskFile.uri}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:morphology]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 5.3: Masked Edge Filtering ──────────────────────────────────
  try {
    maskedEdgeMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('bitwise_and', edgeMat, maskMat, maskedEdgeMat);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:maskedEdges]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 5.4: Edge Dilation ──────────────────────────────────────────
  try {
    dilatedEdgeMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    const ksize5 = OpenCV.createObject(ObjectType.Size, 5, 5);
    edgeKernel5 = (OpenCV as any).invoke('getStructuringElement', 0, ksize5); // MORPH_RECT = 0
    (OpenCV as any).invoke('morphologyEx', maskedEdgeMat, dilatedEdgeMat, 1, edgeKernel5); // MORPH_DILATE = 1
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:edgeDilation]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 5.5: Edge Closing ───────────────────────────────────────────
  try {
    closedEdgeMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    const ksize9 = OpenCV.createObject(ObjectType.Size, 9, 9);
    edgeKernel9 = (OpenCV as any).invoke('getStructuringElement', 0, ksize9); // MORPH_RECT = 0
    (OpenCV as any).invoke('morphologyEx', dilatedEdgeMat, closedEdgeMat, 3, edgeKernel9); // MORPH_CLOSE = 3

    if (__DEV__) {
      // DEBUG: save closed edges to disk
      const edgeFile = new File(Paths.cache, `debug_edges_${Date.now()}.jpg`);
      OpenCV.saveMatToFile(closedEdgeMat, edgeFile.uri, 'jpeg', 0.9);
      console.log(`[DEBUG-AUTOCROP] Saved Closed Edge Map: ${edgeFile.uri}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:edgeClosing]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 6: Find contours ────────────────────────────────────────────────────
  // NOTE: toJSValue(PointVectorOfVectors) returns plain JS {x,y} arrays — NOT
  // native Mat handles. All subsequent contour processing must be pure JS.
  let rawContours: Point[][] = [];
  let rawMaskContours: Point[][] = [];
  const tContourStart = performance.now();
  try {
    ctrData = OpenCV.createObject(ObjectType.PointVectorOfVectors);
    (OpenCV as any).invoke(FIND_CONTOURS, closedEdgeMat, ctrData, RETR_LIST, CHAIN_APPROX_SIMPLE);
    const ctrRaw: any = OpenCV.toJSValue(ctrData);
    const raw = ctrRaw?.array || ctrRaw || [];
    rawContours = Array.isArray(raw) ? raw : [];
    if (__DEV__ && rawContours.length > 0) {
      console.log('[CV FORMAT] first contour sample:', JSON.stringify(rawContours[0]?.slice(0, 3)));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:findContours]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  try {
    maskCtrData = OpenCV.createObject(ObjectType.PointVectorOfVectors);
    (OpenCV as any).invoke(FIND_CONTOURS, maskMat, maskCtrData, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);
    const maskCtrRaw: any = OpenCV.toJSValue(maskCtrData);
    const raw = maskCtrRaw?.array || maskCtrRaw || [];
    rawMaskContours = Array.isArray(raw) ? raw : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CV][STAGE:whiteMaskContours]', msg);
    rawMaskContours = [];
  }

  rawContours = [...rawContours, ...rawMaskContours];

  // ── Contour array guard ───────────────────────────────────────────────────
  console.log(`[DEBUG-AUTOCROP] Stage 6 output: found ${rawContours.length} contours (${rawMaskContours.length} from white-page mask)`);
  if (rawContours.length === 0) {
    safeCleanup();
    return {
      isDocumentDetected: false,
      sharpnessScore,
      motionLevel: 0,
      isStable: false,
      quadrilateral: null,
      captureReadiness: 0,
      confidence: 0,
      areaScore: 0,
      rectangularityScore: 0,
    };
  }

  // ── STAGE 7: Contour processing — pure JS ────────────────────────────────────
  let bestQuad: Quadrilateral | null = null;
  let maxArea = 0;
  const frameArea = width * height;
  const minAreaThreshold = frameArea * 0.03; // Phase 2C temporary relaxed filter

  // Telemetry variables
  const rawContourCount = rawContours.length;
  let filteredContourCount = 0;
  let largestContourArea = 0;
  let largestHullArea = 0;
  let largestHullVertexCount = 0;
  let acceptedCount = 0;
  const contourAreas: number[] = [];

  // Track candidate quads for semantic shape ranking
  const candidates: { quad: Quadrilateral; score: number; telemetry: string; area: number }[] = [];

  const rejectionReasons = {
    TOO_SMALL: 0,
    NOT_4_POINTS: 0,
    INVALID_AREA_RATIO: 0,
    NON_CONVEX: 0,
    PLAUSIBILITY_FAIL: 0
  };

  for (const contour of rawContours) {
    if (!contour || !Array.isArray(contour) || contour.length < 3) continue;

    const area = shoelaceArea(contour);
    contourAreas.push(area);
    if (area > largestContourArea) largestContourArea = area;

    if (area < minAreaThreshold) {
      rejectionReasons.TOO_SMALL++;
      continue;
    }

    filteredContourCount++;

    // 1. Convex Hull
    const hull = convexHull(contour);
    const hullArea = shoelaceArea(hull);

    if (hullArea > largestHullArea) {
      largestHullArea = hullArea;
      largestHullVertexCount = hull.length;
    }

    // 2 & 3. Adaptive Approximation Sweep & Quad Validation
    const peri = perimeter(hull);
    let sweepSuccess = false;
    let sweepRejectedForRatio = false;
    let fallbackPolygon: Point[] | null = null;

    for (let epsilonRatio = 0.01; epsilonRatio <= 0.06; epsilonRatio += 0.005) {
      const approx = cyclicDouglasPeucker(hull, epsilonRatio * peri);

      if (__DEV__) {
        console.log(`[ADAPTIVE-DP] epsilon=${epsilonRatio.toFixed(3)} vertices=${approx.length}`);
      }

      if (approx.length === 5 || approx.length === 6) {
        if (!fallbackPolygon || approx.length < fallbackPolygon.length) {
          fallbackPolygon = approx;
        }
      }

      if (approx.length < 4) {
        if (__DEV__) console.log(`[ADAPTIVE-DP] epsilon=${epsilonRatio.toFixed(3)} COLLAPSED GEOMETRY`);
        break; // Stop iteration, polygon collapsed
      }

      if (approx.length === 4) {
        const orderedQuad = orderPoints(approx);

        // Edge length validation to prevent slivers/degenerate shapes
        const pointsArr = [orderedQuad.topLeft, orderedQuad.topRight, orderedQuad.bottomRight, orderedQuad.bottomLeft];
        const topLen = Math.hypot(pointsArr[1].x - pointsArr[0].x, pointsArr[1].y - pointsArr[0].y);
        const rightLen = Math.hypot(pointsArr[2].x - pointsArr[1].x, pointsArr[2].y - pointsArr[1].y);
        const bottomLen = Math.hypot(pointsArr[3].x - pointsArr[2].x, pointsArr[3].y - pointsArr[2].y);
        const leftLen = Math.hypot(pointsArr[0].x - pointsArr[3].x, pointsArr[0].y - pointsArr[3].y);

        const minEdge = Math.min(topLen, rightLen, bottomLen, leftLen);
        const maxEdge = Math.max(topLen, rightLen, bottomLen, leftLen);

        if (minEdge < 20 || maxEdge / minEdge > 10) {
          if (__DEV__) console.log(`[ADAPTIVE-DP] epsilon=${epsilonRatio.toFixed(3)} vertices=4 REJECTED (Invalid Ratio)`);
          sweepRejectedForRatio = true;
          break; // If a 4-point approximation is degenerate, further epsilons will just collapse it. Stop.
        }

        if (__DEV__) {
          console.log(`[ADAPTIVE-DP] epsilon=${epsilonRatio.toFixed(3)} vertices=4 ACCEPTED`);
        }

        const refinedQuad = refineQuadWithBoundaryPoints(orderedQuad, hull, { width, height });
        const cropGate = evaluateAutoCropCandidate(refinedQuad, { width, height });
        if (!cropGate.accepted || !passesDocumentPlausibility(refinedQuad, hullArea, width, height)) {
          rejectionReasons.PLAUSIBILITY_FAIL++;
          break;
        }

        acceptedCount++;
        sweepSuccess = true;

        const { finalScore, telemetry } = calculateSemanticScore(contour, hull, approx, refinedQuad, width, height);
        candidates.push({
          quad: refinedQuad,
          score: finalScore,
          telemetry: `Score=${finalScore.toFixed(4)} Epsilon=${epsilonRatio.toFixed(3)} | ${telemetry}`,
          area: hullArea
        });
        break;
      }
    }

    // 4. Polygon Semantic Reduction (Phase 3 Extension)
    if (!sweepSuccess && fallbackPolygon) {
      let currentPoly = [...fallbackPolygon];

      while (currentPoly.length > 4) {
        let maxAngle = -1;
        let indexToRemove = -1;
        for (let i = 0; i < currentPoly.length; i++) {
          const prev = currentPoly[(i - 1 + currentPoly.length) % currentPoly.length];
          const curr = currentPoly[i];
          const next = currentPoly[(i + 1) % currentPoly.length];
          const angle = getAngle(prev, curr, next);
          if (angle > maxAngle) {
            maxAngle = angle;
            indexToRemove = i;
          }
        }

        // Remove most collinear vertex if it's flatter than 160 degrees
        if (maxAngle > 160) {
          currentPoly.splice(indexToRemove, 1);
        } else {
          break; // Cannot reduce further safely
        }
      }

      if (currentPoly.length === 4) {
        const orderedQuad = orderPoints(currentPoly);
        const refinedQuad = refineQuadWithBoundaryPoints(orderedQuad, hull, { width, height });
        const pointsArr = [refinedQuad.topLeft, refinedQuad.topRight, refinedQuad.bottomRight, refinedQuad.bottomLeft];
        const topLen = Math.hypot(pointsArr[1].x - pointsArr[0].x, pointsArr[1].y - pointsArr[0].y);
        const rightLen = Math.hypot(pointsArr[2].x - pointsArr[1].x, pointsArr[2].y - pointsArr[1].y);
        const bottomLen = Math.hypot(pointsArr[3].x - pointsArr[2].x, pointsArr[3].y - pointsArr[2].y);
        const leftLen = Math.hypot(pointsArr[0].x - pointsArr[3].x, pointsArr[0].y - pointsArr[3].y);

        const minEdge = Math.min(topLen, rightLen, bottomLen, leftLen);
        const maxEdge = Math.max(topLen, rightLen, bottomLen, leftLen);

        if (minEdge >= 20 && maxEdge / minEdge <= 10) {
          const cropGate = evaluateAutoCropCandidate(refinedQuad, { width, height });
          if (!cropGate.accepted || !passesDocumentPlausibility(refinedQuad, hullArea, width, height)) {
            rejectionReasons.PLAUSIBILITY_FAIL++;
          } else {
            acceptedCount++;
            sweepSuccess = true;
            const { finalScore, telemetry } = calculateSemanticScore(contour, hull, currentPoly, refinedQuad, width, height);
            candidates.push({
              quad: refinedQuad,
              score: finalScore,
              telemetry: `Score=${finalScore.toFixed(4)} SemanticReduced(from ${fallbackPolygon.length}) | ${telemetry}`,
              area: hullArea
            });
          }
        } else {
          sweepRejectedForRatio = true;
        }
      }
    }

    if (!sweepSuccess) {
      const extremaQuad = quadFromExtrema(hull);
      if (extremaQuad) {
        const refinedQuad = refineQuadWithBoundaryPoints(extremaQuad, hull, { width, height });
        const cropGate = evaluateAutoCropCandidate(refinedQuad, { width, height });
        if (!cropGate.accepted || !passesDocumentPlausibility(refinedQuad, hullArea, width, height)) {
          rejectionReasons.PLAUSIBILITY_FAIL++;
        } else {
          acceptedCount++;
          sweepSuccess = true;
          const { finalScore, telemetry } = calculateSemanticScore(contour, hull, hull, refinedQuad, width, height);
          candidates.push({
            quad: refinedQuad,
            score: finalScore * 0.94,
            telemetry: `Score=${(finalScore * 0.94).toFixed(4)} ExtremaFallback | ${telemetry}`,
            area: hullArea
          });
        }
      }
    }

    if (!sweepSuccess) {
      if (sweepRejectedForRatio) {
        rejectionReasons.INVALID_AREA_RATIO++;
      } else {
        rejectionReasons.NOT_4_POINTS++;
      }
      continue;
    }
  }

  if (candidates.length === 0 && rawContours.length > 0) {
    // Attempt relaxed fallback to find the largest plausible contour
    const isConvexPoints = (pts: Point[]): boolean => {
      let positive = 0;
      let negative = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const c = pts[(i + 2) % pts.length];
        const value = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (value > 0) positive++;
        if (value < 0) negative++;
      }
      return positive === pts.length || negative === pts.length;
    };

    let bestFallbackQuad: Quadrilateral | null = null;
    let maxFallbackArea = 0;

    for (const contour of rawContours) {
      if (!contour || !Array.isArray(contour) || contour.length < 3) continue;
      const hull = convexHull(contour);
      const hullArea = shoelaceArea(hull);
      const occupancy = hullArea / frameArea;

      if (occupancy < 0.12) continue; // Must cover at least 12% of the frame

      const extremaQuad = quadFromExtrema(hull);
      if (extremaQuad) {
        const refinedQuad = refineQuadWithBoundaryPoints(extremaQuad, hull, { width, height });
        const pts = [refinedQuad.topLeft, refinedQuad.topRight, refinedQuad.bottomRight, refinedQuad.bottomLeft];
        
        if (isConvexPoints(pts)) {
          const topLen = Math.hypot(refinedQuad.topRight.x - refinedQuad.topLeft.x, refinedQuad.topRight.y - refinedQuad.topLeft.y);
          const bottomLen = Math.hypot(refinedQuad.bottomRight.x - refinedQuad.bottomLeft.x, refinedQuad.bottomRight.y - refinedQuad.bottomLeft.y);
          const leftLen = Math.hypot(refinedQuad.topLeft.x - refinedQuad.bottomLeft.x, refinedQuad.topLeft.y - refinedQuad.bottomLeft.y);
          const rightLen = Math.hypot(refinedQuad.topRight.x - refinedQuad.bottomRight.x, refinedQuad.topRight.y - refinedQuad.bottomRight.y);
          const avgWidth = (topLen + bottomLen) / 2;
          const avgHeight = (leftLen + rightLen) / 2;
          const aspect = avgWidth / Math.max(avgHeight, 1);

          if (aspect >= 0.5 && aspect <= 2.5) {
            if (hullArea > maxFallbackArea) {
              maxFallbackArea = hullArea;
              bestFallbackQuad = refinedQuad;
            }
          }
        }
      }
    }

    if (bestFallbackQuad) {
      console.log(`[CV-FALLBACK] Strict checks failed, using relaxed fallback quad with area=${maxFallbackArea.toFixed(0)}`);
      candidates.push({
        quad: bestFallbackQuad,
        score: 0.1,
        telemetry: 'RelaxedFallbackQuad',
        area: maxFallbackArea
      });
    }
  }

  // Rank candidate quads by semantic score
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    bestQuad = candidates[0].quad;
    maxArea = candidates[0].area;

    if (ENABLE_EMA_SMOOTHING) {
      const currentPts = [bestQuad.topLeft, bestQuad.topRight, bestQuad.bottomRight, bestQuad.bottomLeft];
      if (lastStablePoints) {
        // Calculate drift from last stable points
        let drift = 0;
        for (let i = 0; i < 4; i++) {
          drift += Math.hypot(currentPts[i].x - lastStablePoints[i].x, currentPts[i].y - lastStablePoints[i].y);
        }
        drift /= 4;

        if (drift < EMA_DRIFT_THRESHOLD) {
          stabilityCounter = Math.min(10, stabilityCounter + 1);
          // Apply EMA
          for (let i = 0; i < 4; i++) {
            currentPts[i].x = lastStablePoints[i].x * (1 - EMA_ALPHA) + currentPts[i].x * EMA_ALPHA;
            currentPts[i].y = lastStablePoints[i].y * (1 - EMA_ALPHA) + currentPts[i].y * EMA_ALPHA;
          }
          bestQuad = {
            topLeft: currentPts[0],
            topRight: currentPts[1],
            bottomRight: currentPts[2],
            bottomLeft: currentPts[3]
          };
          lastStablePoints = currentPts;
        } else {
          // Rapid movement detected, decay stability
          stabilityCounter -= 2;
          if (stabilityCounter <= 0) {
            // Snap to new position
            stabilityCounter = 1;
            lastStablePoints = currentPts;
          } else {
            // Keep old stable points while decaying
            bestQuad = {
              topLeft: lastStablePoints[0],
              topRight: lastStablePoints[1],
              bottomRight: lastStablePoints[2],
              bottomLeft: lastStablePoints[3]
            };
          }
        }
      } else {
        lastStablePoints = currentPts;
        stabilityCounter = 1;
      }
    }
  } else {
    if (ENABLE_EMA_SMOOTHING) {
      stabilityCounter -= 2;
      if (stabilityCounter <= 0) {
        lastStablePoints = null;
        stabilityCounter = 0;
      } else if (lastStablePoints) {
        // Coasting for a few frames if dropped
        bestQuad = {
          topLeft: lastStablePoints[0],
          topRight: lastStablePoints[1],
          bottomRight: lastStablePoints[2],
          bottomLeft: lastStablePoints[3]
        };
      }
    }
  }

  contourAreas.sort((a, b) => b - a);
  const top5Areas = contourAreas.slice(0, 5).map(a => Math.round(a));

  console.log(`[TELEMETRY] FrameArea=${frameArea} MinArea=${minAreaThreshold} LargestArea=${largestContourArea.toFixed(0)} LargestAreaRatio=${(largestContourArea / frameArea).toFixed(3)}`);
  console.log(`[TELEMETRY] Contours: Raw=${rawContourCount} Filtered=${filteredContourCount} LargestHullArea=${largestHullArea.toFixed(0)} LargestHullVertices=${largestHullVertexCount}`);
  console.log(`[TELEMETRY] Top5ContourAreas=[${top5Areas.join(', ')}]`);
  console.log(`[TELEMETRY] Accepted Quads=${acceptedCount}. Rejections:`, JSON.stringify(rejectionReasons));

  if (__DEV__) {
    console.log(`[SEMANTIC-RANKING] Total valid candidate quads: ${candidates.length}`);
    candidates.slice(0, 5).forEach((cand, idx) => {
      console.log(`  Rank #${idx + 1}: ${cand.telemetry} | HullArea=${cand.area.toFixed(0)}`);
    });
  }

  if (bestQuad && __DEV__) {
    console.log(`[TELEMETRY] Final Quad:`, JSON.stringify(bestQuad));
  }

  // Release all OpenCV mats — contour work is done in JS
  safeCleanup();
  tContour = performance.now() - tContourStart;

  const tTotal = performance.now() - tStart;
  console.log(`[TIMING] detectDocumentInFrame: Total=${tTotal.toFixed(1)}ms (imread=${tImread.toFixed(1)}ms, contour=${tContour.toFixed(1)}ms)`);

  // ── Motion & readiness ────────────────────────────────────────────────────────
  const currentPoints = bestQuad
    ? [bestQuad.topLeft, bestQuad.topRight, bestQuad.bottomRight, bestQuad.bottomLeft]
    : [];
  const motionLevel = calculateMotion(currentPoints, lastPoints);
  lastPoints = currentPoints;

  const areaRatio = maxArea / frameArea;
  // Lowered isSharp threshold — entropy heuristic scores differently from Laplacian
  const isSharp = sharpnessScore > 30;
  const isStable = motionLevel < 60;
  const isLarge = areaRatio > 0.08;

  let captureReadiness = 0;
  let areaScore = 0;
  let rectangularityScore = 0;
  let confidence = 0;

  if (bestQuad) {
    captureReadiness = 20;
    if (isSharp) captureReadiness += 30;
    if (isLarge) captureReadiness += 20;
    if (isStable) captureReadiness += 30;

    areaScore = Math.min(1, areaRatio * 2);

    let minX = width, maxX = 0, minY = height, maxY = 0;
    currentPoints.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const bboxArea = (maxX - minX) * (maxY - minY);
    rectangularityScore = bboxArea > 0 ? maxArea / bboxArea : 0;

    // Divisor 100 — entropy sharpness tops out around 100, Laplacian may be higher
    confidence = 0.3
      + (areaScore * 0.3)
      + (rectangularityScore * 0.2)
      + (Math.min(1, sharpnessScore / 100) * 0.2);

  } else {
    // Sharpness-only fallback: fires when paper is held but edges aren't detected.
    // Max fallback confidence stays below typical quad confidence (~0.6+) so quad
    // detection wins when it works.
    if (sharpnessScore > 50) {
      confidence = 0.35 + Math.min(0.10, sharpnessScore / 1000);
      captureReadiness = 35;
    } else if (sharpnessScore > 20) {
      confidence = 0.25;
      captureReadiness = 20;
    }
  }

  // Synthetic isStable for the no-quad fallback path (can't measure motion without points)
  const syntheticStable = !bestQuad && sharpnessScore > 20;

  return {
    isDocumentDetected: !!bestQuad,
    sharpnessScore,
    motionLevel,
    isStable: bestQuad ? isStable : syntheticStable,
    quadrilateral: bestQuad,
    dimensions: { width, height },
    captureReadiness,
    confidence,
    areaScore,
    rectangularityScore,
  };
}

/**
 * Order points consistently: Top-Left, Top-Right, Bottom-Right, Bottom-Left
 */
function orderPoints(points: Point[]): Quadrilateral {
  if (ENABLE_CENTROID_ORDERING) {
    const cx = points.reduce((sum, p) => sum + p.x, 0) / 4;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / 4;

    const sorted = [...points].sort((a, b) => {
      const angleA = Math.atan2(a.y - cy, a.x - cx);
      const angleB = Math.atan2(b.y - cy, b.x - cx);
      return angleA - angleB;
    });

    // atan2 ranges from -PI to PI
    // TL: negative x, negative y -> ~ -135 deg
    // TR: positive x, negative y -> ~ -45 deg
    // BR: positive x, positive y -> ~ 45 deg
    // BL: negative x, positive y -> ~ 135 deg
    return {
      topLeft: sorted[0],
      topRight: sorted[1],
      bottomRight: sorted[2],
      bottomLeft: sorted[3]
    };
  }

  // Sort by Y to find top and bottom
  const sortedByY = [...points].sort((a, b) => a.y - b.y);
  const topPoints = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottomPoints = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);

  return {
    topLeft: topPoints[0],
    topRight: topPoints[1],
    bottomRight: bottomPoints[1],
    bottomLeft: bottomPoints[0],
  };
}

function quadFromExtrema(points: Point[]): Quadrilateral | null {
  if (points.length < 4) return null;

  const topLeft = points.reduce((best, point) => (point.x + point.y < best.x + best.y ? point : best), points[0]);
  const bottomRight = points.reduce((best, point) => (point.x + point.y > best.x + best.y ? point : best), points[0]);
  const topRight = points.reduce((best, point) => (point.x - point.y > best.x - best.y ? point : best), points[0]);
  const bottomLeft = points.reduce((best, point) => (point.x - point.y < best.x - best.y ? point : best), points[0]);
  const quad = { topLeft, topRight, bottomRight, bottomLeft };
  const ordered = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      if (Math.hypot(ordered[i].x - ordered[j].x, ordered[i].y - ordered[j].y) < 24) {
        return null;
      }
    }
  }

  return quad;
}

/**
 * Calculate average pixel drift between frames
 */
function calculateMotion(current: Point[], last: Point[]): number {
  if (current.length === 0 || last.length === 0) return 100;
  let totalDrift = 0;
  for (let i = 0; i < current.length; i++) {
    const dx = current[i].x - last[i].x;
    const dy = current[i].y - last[i].y;
    totalDrift += Math.sqrt(dx * dx + dy * dy);
  }
  return totalDrift / current.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure JS geometry helpers
// These replace OpenCV invoke calls on deserialized JS point arrays.
// ─────────────────────────────────────────────────────────────────────────────

/** Shoelace formula: signed area of a polygon from an {x,y} point array */
function shoelaceArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Perimeter of a closed polygon from an {x,y} point array */
/**
 * Document Plausibility Validation Layer:
 * Evaluates physical dimensions (occupancy, width/height spans, and letter/A4 aspect ratios)
 * to filter out tiny internal printed blocks, text bands, shadows, or desk slivers.
 */
function passesDocumentPlausibility(
  quad: Quadrilateral,
  hullArea: number,
  frameWidth: number,
  frameHeight: number
): boolean {
  const frameArea = frameWidth * frameHeight;
  const occupancy = hullArea / frameArea;

  // Quad Bounds
  const qPoints = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let minX = frameWidth, maxX = 0, minY = frameHeight, maxY = 0;
  qPoints.forEach(p => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });

  const widthCoverage = (maxX - minX) / frameWidth;
  const heightCoverage = (maxY - minY) / frameHeight;

  // Edge Lengths
  const topLen = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  const bottomLen = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
  const leftLen = Math.hypot(quad.topLeft.x - quad.bottomLeft.x, quad.topLeft.y - quad.bottomLeft.y);
  const rightLen = Math.hypot(quad.topRight.x - quad.bottomRight.x, quad.topRight.y - quad.bottomRight.y);

  const avgWidth = (topLen + bottomLen) / 2;
  const avgHeight = (leftLen + rightLen) / 2;
  const aspectRatio = avgWidth / Math.max(avgHeight, 1);

  if (occupancy < 0.03) {
    if (__DEV__) {
      console.log(`[Plausibility Reject] occupancy=${occupancy.toFixed(3)} widthCoverage=${widthCoverage.toFixed(2)} heightCoverage=${heightCoverage.toFixed(2)} aspect=${aspectRatio.toFixed(2)} | reason=LOW_OCCUPANCY`);
    }
    return false;
  }
  if (widthCoverage < 0.15) {
    if (__DEV__) {
      console.log(`[Plausibility Reject] occupancy=${occupancy.toFixed(3)} widthCoverage=${widthCoverage.toFixed(2)} heightCoverage=${heightCoverage.toFixed(2)} aspect=${aspectRatio.toFixed(2)} | reason=LOW_WIDTH_COVERAGE`);
    }
    return false;
  }
  if (heightCoverage < 0.15) {
    if (__DEV__) {
      console.log(`[Plausibility Reject] occupancy=${occupancy.toFixed(3)} widthCoverage=${widthCoverage.toFixed(2)} heightCoverage=${heightCoverage.toFixed(2)} aspect=${aspectRatio.toFixed(2)} | reason=LOW_HEIGHT_COVERAGE`);
    }
    return false;
  }
  if (aspectRatio < 0.6 || aspectRatio > 2.2) {
    if (__DEV__) {
      console.log(`[Plausibility Reject] occupancy=${occupancy.toFixed(3)} widthCoverage=${widthCoverage.toFixed(2)} heightCoverage=${heightCoverage.toFixed(2)} aspect=${aspectRatio.toFixed(2)} | reason=INVALID_ASPECT_RATIO`);
    }
    return false;
  }

  return true;
}

/**
 * Calculate multi-dimensional weighted shape semantic score to rank contours.
 * Directly penalizes high angle deviations and extreme edge imbalances,
 * preventing desk borders or diagonal slivers from hijacking crop detection.
 */
function calculateSemanticScore(
  contour: Point[],
  hull: Point[],
  approx: Point[],
  quad: Quadrilateral,
  width: number,
  height: number
): { finalScore: number; telemetry: string } {
  const frameArea = width * height;
  const cArea = shoelaceArea(contour);
  const hArea = shoelaceArea(hull);

  // 1. Area Score (30%) - Square-root compressed scale
  const areaRatio = hArea / frameArea;
  const areaScore = Math.sqrt(Math.min(1, areaRatio / 0.7));

  // 2. Rectangularity (20%) - Using simplified quad bounding box
  let minX = width, maxX = 0, minY = height, maxY = 0;
  const qPoints = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  qPoints.forEach(p => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });
  const bboxArea = (maxX - minX) * (maxY - minY);
  const rectangularity = bboxArea > 0 ? Math.min(1.0, cArea / bboxArea) : 0;

  // 3. Angle Quality (20%) - Exponential decay
  const angles = [
    getAngle(quad.bottomLeft, quad.topLeft, quad.topRight),
    getAngle(quad.topLeft, quad.topRight, quad.bottomRight),
    getAngle(quad.topRight, quad.bottomRight, quad.bottomLeft),
    getAngle(quad.bottomRight, quad.bottomLeft, quad.topLeft),
  ];
  let angleDevSum = 0;
  angles.forEach(a => {
    angleDevSum += Math.abs(a - 90);
  });
  const avgAngleDev = angleDevSum / 4;
  const angleScore = Math.exp(-avgAngleDev / (ENABLE_RELAXED_SCORING ? 30 : 18));

  // 4. Edge Balance (15%) - Clamped for perspective tolerance
  const topLen = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  const bottomLen = Math.hypot(quad.bottomRight.x - quad.bottomLeft.x, quad.bottomRight.y - quad.bottomLeft.y);
  const leftLen = Math.hypot(quad.topLeft.x - quad.bottomLeft.x, quad.topLeft.y - quad.bottomLeft.y);
  const rightLen = Math.hypot(quad.topRight.x - quad.bottomRight.x, quad.topRight.y - quad.bottomRight.y);

  const tbRatio = Math.max(0.35, Math.min(topLen, bottomLen) / Math.max(1, Math.max(topLen, bottomLen)));
  const lrRatio = Math.max(0.35, Math.min(leftLen, rightLen) / Math.max(1, Math.max(leftLen, rightLen)));
  const edgeBalance = (tbRatio + lrRatio) / 2;

  // 5. Center Bias (10%)
  const centerX = width / 2;
  const centerY = height / 2;
  const centroidX = (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4;
  const centroidY = (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4;
  const distFromCenter = Math.hypot(centroidX - centerX, centroidY - centerY);
  const maxDiag = Math.hypot(width, height) / 2;
  const centerBias = Math.max(0, 1 - distFromCenter / maxDiag);

  // 6. Solidity (5%)
  const solidity = hArea > 0 ? cArea / hArea : 0;

  // Compute final weighted score
  const finalScore =
    (areaScore * 0.30) +
    (rectangularity * 0.20) +
    (angleScore * 0.20) +
    (edgeBalance * 0.15) +
    (centerBias * 0.10) +
    (solidity * 0.05);

  const telemetry = `AreaS=${areaScore.toFixed(2)} RectS=${rectangularity.toFixed(2)} AngleS=${angleScore.toFixed(2)} EdgeS=${edgeBalance.toFixed(2)} CentS=${centerBias.toFixed(2)} SolidS=${solidity.toFixed(2)}`;

  return { finalScore, telemetry };
}

function perimeter(pts: Point[]): number {
  let total = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/** Douglas-Peucker polygon simplification (equivalent to approxPolyDP) */
function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let maxIdx = 0;
  const start = pts[0];
  const end = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = perpendicularDistance(pts[i], start, end);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

/**
 * Cyclic Douglas-Peucker: pre-conditions the closed hull loop to prevent fixed endpoint lock.
 * Finds the two furthest points on the hull, splits it into two open polylines, simplifies
 * them separately, and merges the result back cyclically.
 */
function cyclicDouglasPeucker(hull: Point[], epsilon: number): Point[] {
  if (hull.length <= 4) return douglasPeucker(hull, epsilon);

  let maxDistSq = 0;
  let idxA = 0;
  let idxB = 0;
  const n = hull.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = hull[i].x - hull[j].x;
      const dy = hull[i].y - hull[j].y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        idxA = i;
        idxB = j;
      }
    }
  }

  // Ensure winding/ordering: idxA < idxB
  if (idxA > idxB) {
    const temp = idxA;
    idxA = idxB;
    idxB = temp;
  }

  // Split hull into two halves
  // Half 1: idxA -> idxB (inclusive)
  const half1 = hull.slice(idxA, idxB + 1);

  // Half 2: idxB -> End -> Start -> idxA
  const half2: Point[] = [];
  for (let i = idxB; i < n; i++) {
    half2.push(hull[i]);
  }
  for (let i = 0; i <= idxA; i++) {
    half2.push(hull[i]);
  }

  // Run standard DP on both halves
  const simp1 = douglasPeucker(half1, epsilon);
  const simp2 = douglasPeucker(half2, epsilon);

  // Merge simplified halves without duplicate endpoints
  const merged = [...simp1.slice(0, -1), ...simp2.slice(0, -1)];

  if (__DEV__) {
    console.log(`[CYCLIC-DP] Split anchors: A=${idxA}, B=${idxB} | Half1: ${half1.length}->${simp1.length} | Half2: ${half2.length}->${simp2.length} | Merged: ${merged.length}`);
  }

  return merged;
}

/** Perpendicular distance from point p to line segment a→b */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x)
    / Math.sqrt(dx * dx + dy * dy);
}

export async function nativeProcessImage(
  imageUri: string,
  options: {
    targetWidth: number,
    grayscale?: boolean,
    autoCrop?: boolean,
    enhance?: boolean,
    points?: { x: number, y: number }[]
  }
): Promise<{ uri: string }> {
  try {
    // 1. Resize and Compress using native module (Safe memory usage)
    // We resize BEFORE sending to backend to save bandwidth/memory
    const resized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: options.targetWidth } }],
      {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false
      }
    );

    let finalUri = resized.uri;

    if (options.enhance || options.points) {
      try {
        console.log('[ISOLATION] nativeProcessImage: Enhancement requested (Binary Flow)');
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

        // 2. STABILITY: Use FormData for binary upload to prevent bridge Base64 overload
        const formData = new FormData();

        // @ts-ignore - React Native FormData expects an object with uri, name, and type
        formData.append('file', {
          uri: finalUri,
          name: 'enhance_capture.jpg',
          type: 'image/jpeg',
        });

        formData.append('mode', 'enhanced');
        if (options.points) {
          formData.append('points', JSON.stringify(options.points.map(p => [p.x, p.y])));
        }

        console.log('[ISOLATION] fetch (Enhance-File): START (Multipart)');
        const response = await fetch(`${backendUrl}/api/scan-sessions/enhance-file`, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json',
          },
        });
        console.log('[ISOLATION] fetch (Enhance-File): SUCCESS', response.status);

        if (response.ok) {
          const data = await response.json();
          if (data.enhanced_image) {
            console.log('[ISOLATION] FileSystem.writeAsString: START');
            const enhancedFile = new File(Paths.document, `proc_${Date.now()}.jpg`);
            // write() accepts a string; for base64, we write the raw base64 data string with correct encoding
            enhancedFile.write(data.enhanced_image, { encoding: 'base64' });

            // CLEANUP: Delete the intermediate resized image to save space
            try {
              const resizedFile = new File(resized.uri);
              resizedFile.delete();
            } catch (e) {
              console.warn('[Cleanup] Failed to delete temp resized image:', e);
            }

            finalUri = enhancedFile.uri;
            console.log('[ISOLATION] FileSystem.writeAsString: SUCCESS');
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[ISOLATION] Binary enhancement fallback:', msg);
      }
    }

    return { uri: finalUri };
  } catch (e) {
    console.error('[CV] Processing failed:', e);
    return { uri: imageUri };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions for Polygon Extraction and Native Grayscale Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monotone Chain Convex Hull algorithm
 * Returns the convex hull of a set of 2D points.
 */
function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points;

  // Sort points lexicographically
  const sorted = [...points].sort((a, b) => {
    if (a.x === b.x) return a.y - b.y;
    return a.x - b.x;
  });

  const cross = (o: Point, a: Point, b: Point) => {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  };

  const lower: Point[] = [];
  for (let i = 0; i < sorted.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Angle between vectors BA and BC in degrees (0-180) */
function getAngle(A: Point, B: Point, C: Point): number {
  const ba = { x: A.x - B.x, y: A.y - B.y };
  const bc = { x: C.x - B.x, y: C.y - B.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magA = Math.hypot(ba.x, ba.y);
  const magC = Math.hypot(bc.x, bc.y);
  if (magA === 0 || magC === 0) return 180;
  const cosTheta = Math.max(-1, Math.min(1, dot / (magA * magC)));
  return Math.acos(cosTheta) * (180 / Math.PI);
}

/**
 * Convert an image file to grayscale using OpenCV and save to a new file.
 * Returns the URI of the grayscale file.
 * Falls back to the original URI if OpenCV conversion fails.
 */
export async function convertToGrayscale(
  imageUri: string,
  options?: { compress?: number; maxWidth?: number }
): Promise<string> {
  let srcMat: any = null;
  let grayMat: any = null;
  let resizedUri: string | null = null;

  try {
    const tStart = performance.now();
    // 1. Resize and save to disk
    const compress = options?.compress ?? 0.85;
    const maxWidth = options?.maxWidth ?? 1200;
    const resized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: maxWidth } }],
      { compress: compress, format: ImageManipulator.SaveFormat.JPEG, base64: false }
    );
    const tResize = performance.now() - tStart;

    resizedUri = resized.uri;

    const tLoadStart = performance.now();
    // 2. Read image as base64 and decode to Mat
    const base64 = await FileSystem.readAsStringAsync(resizedUri, {
      encoding: 'base64',
    });

    srcMat = OpenCV.base64ToMat(base64);

    const tImread = performance.now() - tLoadStart;

    if (!srcMat || srcMat.cols <= 0 || srcMat.rows <= 0) {
      throw new Error(`imread returned empty Mat`);
    }

    // 3. Grayscale conversion via color converter
    grayMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('cvtColor', srcMat, grayMat, 6); // COLOR_RGBA2GRAY = 6

    // 4. Save directly using the high-performance native saver
    const destFilename = `bw_${Date.now()}.jpg`;
    const dest = new File(Paths.document, destFilename);
    OpenCV.saveMatToFile(grayMat, dest.uri, 'jpeg', 0.9);

    const tTotal = performance.now() - tStart;
    console.log(`[TIMING] convertToGrayscale: Total=${tTotal.toFixed(1)}ms (resize=${tResize.toFixed(1)}ms, imread=${tImread.toFixed(1)}ms)`);

    // Verify file exists
    if (!dest.exists) throw new Error('Grayscale output file was not created');

    // Safe cleanup of temporary resized image
    try {
      if (resizedUri && resizedUri !== imageUri) {
        new File(resizedUri).delete();
      }
    } catch (_) { }

    return dest.uri;
  } catch (err) {
    console.warn('[CV] convertToGrayscale failed, keeping color:', err);
    return imageUri; // safe color fallback
  } finally {
    cleanupMats([srcMat, grayMat]);
    try {
      OpenCV.clearBuffers();
    } catch (_) { }
  }
}

export type FilterMode = 'original' | 'grayscale' | 'high_contrast' | 'adaptive_threshold';

/**
 * OCR-Optimized Filters — designed for maximum text legibility in extraction pipelines.
 *
 * original           → No processing. Good lighting, clean background.
 * grayscale          → Removes color noise. Better for OCR than color on most engines.
 * high_contrast      → Natural document cleanup: bright paper, darker ink,
 *                      and preserved grayscale texture for long review sessions.
 * adaptive_threshold → Full binarization. Converts to pure black text on white.
 *                      Best for typed text, printed documents, and Tesseract/Google OCR.
 */
export async function applyFilter(
  imageUri: string,
  mode: FilterMode,
  options?: { compress?: number; maxWidth?: number }
): Promise<string> {
  if (mode === 'original') return imageUri;

  if (mode === 'grayscale') {
    return convertToGrayscale(imageUri, options);
  }

  let srcMat: any = null;   // 4-channel RGBA decoded from JPEG
  let grayMat: any = null;  // 1-channel gray
  let blurMat: any = null;  // 1-channel blurred gray
  let sharpMat: any = null; // 1-channel sharpened gray
  let binaryMat: any = null; // 1-channel adaptive text mask
  let paperMat: any = null; // 1-channel lifted paper base
  let dstMat: any = null;   // 1-channel output
  let resizedUri: string | null = null;

  try {
    const tStart = performance.now();
    const compress = options?.compress ?? 0.90;
    const maxWidth = options?.maxWidth ?? 1600;
    const resized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: maxWidth } }],
      { compress: compress, format: ImageManipulator.SaveFormat.JPEG, base64: false }
    );
    const tResize = performance.now() - tStart;
    resizedUri = resized.uri;

    const tLoadStart = performance.now();
    // Read image as base64 and decode to Mat
    const base64 = await FileSystem.readAsStringAsync(resizedUri, {
      encoding: 'base64',
    });

    srcMat = OpenCV.base64ToMat(base64);

    const tImread = performance.now() - tLoadStart;

    if (!srcMat || srcMat.cols <= 0 || srcMat.rows <= 0) {
      throw new Error(`imread returned empty Mat`);
    }

    if (mode === 'high_contrast') {
      // Color-preserving High Contrast (keeps colors, whitens background)
      dstMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC4);
      try {
        blurMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC4);
        const blurSize = OpenCV.createObject(ObjectType.Size, 71, 71);
        (OpenCV as any).invoke('GaussianBlur', srcMat, blurMat, blurSize, 0);
        (OpenCV as any).invoke('divide', srcMat, blurMat, dstMat, 255);
        
        // Unsharp mask to sharpen handwriting strokes
        sharpMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC4);
        const sharpBlurSize = OpenCV.createObject(ObjectType.Size, 5, 5);
        (OpenCV as any).invoke('GaussianBlur', dstMat, sharpMat, sharpBlurSize, 0);
        (OpenCV as any).invoke('addWeighted', dstMat, 1.6, sharpMat, -0.6, 0.0, dstMat);
        
        // Contrast adjustment: make text extra dark, paper background pure white.
        (OpenCV as any).invoke('addWeighted', dstMat, 1.9, dstMat, 0.0, -160.0, dstMat);
      } catch (enhanceErr) {
        console.warn('[CV] color high_contrast division normalization failed, using fallback:', enhanceErr);
        // Fallback to grayscale high contrast
        cleanupMats([blurMat, sharpMat, dstMat]);
        
        grayMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
        (OpenCV as any).invoke('cvtColor', srcMat, grayMat, 6); // 6 is COLOR_RGBA2GRAY
        dstMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
        
        (OpenCV as any).invoke('addWeighted', grayMat, 1.28, grayMat, 0.0, -18.0, dstMat);
      }
    } else {
      // Grayscale conversion for adaptive_threshold
      grayMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
      (OpenCV as any).invoke('cvtColor', srcMat, grayMat, 6); // 6 is COLOR_RGBA2GRAY
      dstMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
      
      if (mode === 'adaptive_threshold') {
        blurMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
        const blurSize = OpenCV.createObject(ObjectType.Size, 3, 3);
        (OpenCV as any).invoke('GaussianBlur', grayMat, blurMat, blurSize, 0);
        (OpenCV as any).invoke(
          'adaptiveThreshold',
          blurMat, dstMat,
          255,          // maxValue
          1,            // ADAPTIVE_THRESH_GAUSSIAN_C
          0,            // THRESH_BINARY
          21,           // blockSize
          10,           // C
        );
      }
    }

    const destFilename = `ocr_${mode}_${Date.now()}.jpg`;
    const dest = new File(Paths.document, destFilename);
    const tSaveStart = performance.now();
    OpenCV.saveMatToFile(dstMat, dest.uri, 'jpeg', mode === 'adaptive_threshold' ? 0.82 : 0.92);
    const tSave = performance.now() - tSaveStart;

    const tTotal = performance.now() - tStart;
    console.log(`[TIMING] applyFilter: Total=${tTotal.toFixed(1)}ms (resize=${tResize.toFixed(1)}ms, imread=${tImread.toFixed(1)}ms, save=${tSave.toFixed(1)}ms)`);

    if (!dest.exists) return convertToGrayscale(imageUri);

    // Clean up the intermediate resized file
    try {
      if (resizedUri && resizedUri !== imageUri) new File(resizedUri).delete();
    } catch (_) { }

    return dest.uri;
  } catch (err) {
    console.warn(`[CV] applyFilter(${mode}) failed, falling back to grayscale:`, err);
    return convertToGrayscale(imageUri);
  } finally {
    cleanupMats([srcMat, grayMat, blurMat, sharpMat, binaryMat, paperMat, dstMat]);
    try {
      if (resizedUri && resizedUri !== imageUri) new File(resizedUri).delete();
    } catch (_) { }
    try { OpenCV.clearBuffers(); } catch (_) { }
  }
}
