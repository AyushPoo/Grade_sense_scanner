import * as ImageManipulator from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { OpenCV, ObjectType, DataTypes } from 'react-native-fast-opencv';

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
const CHAIN_APPROX_SIMPLE = 2;
const CONTOUR_AREA = 'contourArea';
const ARC_LENGTH = 'arcLength';
const APPROX_POLY_DP = 'approxPolyDP';

let lastPoints: Point[] = [];

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
  base64Image: string,
  width: number,
  height: number
): Promise<CVProcessingResult> {
  // ── INPUT GUARDS ─────────────────────────────────────────────────────────
  // Prevent undefined/empty strings reaching OpenCV JSI (causes HostFunction crash)
  if (!base64Image || typeof base64Image !== 'string' || base64Image.length < 10) {
    console.warn('[CV] detectDocumentInFrame: invalid base64 input — returning safe default');
    return { ...SAFE_NO_DETECT_RESULT };
  }
  if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    console.warn('[CV] detectDocumentInFrame: invalid dimensions — returning safe default');
    return { ...SAFE_NO_DETECT_RESULT };
  }
  // ─────────────────────────────────────────────────────────────────────────
  // Declare all mats upfront so cleanup is always reachable
  let srcMat: any    = null;
  let grayMat: any   = null;
  let lapMat: any    = null;
  let meanMat: any   = null;
  let stddevMat: any = null;
  let blurMat: any   = null;
  let ksizeMat: any  = null;
  let edgeMat: any   = null;
  let ctrData: any   = null;

  /** Cleanup all allocated mats + clear OpenCV buffer pool */
  const safeCleanup = () => {
    cleanupMats([srcMat, grayMat, lapMat, meanMat, stddevMat, blurMat, ksizeMat, edgeMat, ctrData]);
    try { OpenCV.clearBuffers(); } catch { /* ignore */ }
  };

  // ── STAGE 1: base64 → Mat ─────────────────────────────────────────────────────────
  try {
    srcMat = OpenCV.base64ToMat(base64Image);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:base64ToMat]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 2: Grayscale conversion ────────────────────────────────────────────────
  try {
    grayMat = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('cvtColor', srcMat, grayMat, COLOR_RGBA2GRAY);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:grayscale]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 3: Sharpness (Laplacian) — non-fatal ────────────────────────────────
  let sharpnessScore = 0;
  try {
    lapMat    = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    // All 7 params required: src, dst, ddepth, ksize, scale, delta, borderType
    (OpenCV as any).invoke('Laplacian', grayMat, lapMat, 3, 1, 1, 0, 4);
    meanMat   = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    stddevMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    (OpenCV as any).invoke('meanStdDev', lapMat, meanMat, stddevMat);
    const stddevRaw: any  = OpenCV.toJSValue(stddevMat);
    const stddevArr: any  = stddevRaw?.array || stddevRaw;
    sharpnessScore = Math.pow(Array.isArray(stddevArr) ? stddevArr[0] : 0, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CV][STAGE:sharpness] (non-fatal — continuing with score=0):', msg);
    cleanupMats([lapMat, meanMat, stddevMat]);
    lapMat = null; meanMat = null; stddevMat = null;
    sharpnessScore = 0;
  }

  // ── STAGE 4: Gaussian blur ───────────────────────────────────────────────────
  try {
    blurMat  = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
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
    (OpenCV as any).invoke(CANNY, blurMat, edgeMat, 75, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:canny]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 6: Find contours ────────────────────────────────────────────────────
  let contours: any[] = [];
  try {
    ctrData = OpenCV.createObject(ObjectType.PointVectorOfVectors);
    (OpenCV as any).invoke(FIND_CONTOURS, edgeMat, ctrData, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);
    const ctrRaw: any = OpenCV.toJSValue(ctrData);
    contours = ctrRaw?.array || ctrRaw || [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:findContours]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── Strict contour array guard ───────────────────────────────────────────────────────
  if (!contours || !Array.isArray(contours) || contours.length === 0) {
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

  // ── STAGE 7: Contour processing (each contour isolated) ──────────────────────
  let bestQuad: Quadrilateral | null = null;
  let maxArea = 0;
  const frameArea = width * height;

  for (let i = 0; i < contours.length; i++) {
    const contour = contours[i];
    // Strict per-contour guards
    if (!contour) continue;
    if (contour.length !== undefined && contour.length < 4) continue;

    try {
      const area = (OpenCV as any).invoke(CONTOUR_AREA, contour);
      if (!area || area < frameArea * 0.15) continue;

      const peri = (OpenCV as any).invoke(ARC_LENGTH, contour, true);
      if (!peri || peri <= 0) continue;

      const approxData = OpenCV.createObject(ObjectType.PointVector);
      (OpenCV as any).invoke(APPROX_POLY_DP, contour, approxData, 0.02 * peri, true);
      const approxRaw: any = OpenCV.toJSValue(approxData);
      const approx = approxRaw?.array || approxRaw;

      // Strict approx guards
      if (!approx) continue;
      if (!Array.isArray(approx)) continue;
      if (approx.length !== 4) continue;

      if (area > maxArea) {
        maxArea = area;
        bestQuad = orderPoints(approx);
      }
    } catch {
      continue; // per-contour error — skip and try next
    }
  }

  // ── Motion & readiness ───────────────────────────────────────────────────────────────
  const currentPoints = bestQuad
    ? [bestQuad.topLeft, bestQuad.topRight, bestQuad.bottomRight, bestQuad.bottomLeft]
    : [];
  const motionLevel = calculateMotion(currentPoints, lastPoints);
  lastPoints = currentPoints;

  const areaRatio = maxArea / frameArea;
  const isSharp   = sharpnessScore > 50;
  const isStable  = motionLevel < 15;
  const isLarge   = areaRatio > 0.25;

  let captureReadiness = 0;
  let areaScore = 0;
  let rectangularityScore = 0;
  let confidence = 0;

  if (bestQuad) {
    captureReadiness = 20;
    if (isSharp)  captureReadiness += 30;
    if (isLarge)  captureReadiness += 20;
    if (isStable) captureReadiness += 30;

    // Continuous confidence derivation
    areaScore = Math.min(1, areaRatio * 2); // 50% frame area is a perfect 1.0 score
    
    let minX = width, maxX = 0, minY = height, maxY = 0;
    currentPoints.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const bboxArea = (maxX - minX) * (maxY - minY);
    rectangularityScore = bboxArea > 0 ? maxArea / bboxArea : 0;

    confidence = 0.3 
      + (areaScore * 0.3) 
      + (rectangularityScore * 0.2) 
      + (Math.min(1, sharpnessScore / 50) * 0.2);
  }

  safeCleanup();

  return {
    isDocumentDetected: !!bestQuad,
    sharpnessScore,
    motionLevel,
    isStable,
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
