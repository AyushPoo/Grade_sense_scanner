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

  // ── STAGE 3: Sharpness — try OpenCV Laplacian, fall back to entropy heuristic ──
  let sharpnessScore = 0;
  try {
    lapMat    = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('Laplacian', grayMat, lapMat, 3, 1, 1, 0, 4);
    meanMat   = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
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

  // Pure-JS entropy fallback: sharp images have more high-freq detail → JPEG
  // compresses less → larger base64. Calibrated: 0.5 bpp=0, 6.0 bpp=100.
  if (sharpnessScore === 0) {
    // Calibrated for detection frames: quality:0.4 JPEG at 640px
    // Old anchors (0.5–6.0) were for quality:0.8 full captures — every frame scored 0.
    // At quality:0.4, 640px:
    //   Empty/blurry frame: bpp ≈ 0.05–0.10
    //   Paper in frame:     bpp ≈ 0.10–0.25
    //   Sharp document:     bpp ≈ 0.20–0.37
    const estimatedPixels = width * height;
    const actualBytes = base64Image.length * 0.75;
    const bpp = actualBytes / estimatedPixels;
    const BPP_FLOOR   = 0.05;  // floor: very blurry / empty frame at quality:0.4
    const BPP_CEILING = 0.40;  // ceiling: sharp document edge at quality:0.4
    const normalized = (bpp - BPP_FLOOR) / (BPP_CEILING - BPP_FLOOR) * 100;
    sharpnessScore = Math.max(0, Math.min(100, normalized));
    if (__DEV__) {
      console.log(`[CV SHARPNESS] bpp=${bpp.toFixed(4)}, score=${sharpnessScore.toFixed(1)}`);
    }
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
    (OpenCV as any).invoke(CANNY, blurMat, edgeMat, 30, 100);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CV][STAGE:canny]', msg);
    safeCleanup();
    return { ...SAFE_NO_DETECT_RESULT };
  }

  // ── STAGE 6: Find contours ────────────────────────────────────────────────────
  // NOTE: toJSValue(PointVectorOfVectors) returns plain JS {x,y} arrays — NOT
  // native Mat handles. All subsequent contour processing must be pure JS.
  let rawContours: Point[][] = [];
  try {
    ctrData = OpenCV.createObject(ObjectType.PointVectorOfVectors);
    (OpenCV as any).invoke(FIND_CONTOURS, edgeMat, ctrData, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);
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

  // ── Contour array guard ───────────────────────────────────────────────────
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
  // ROOT CAUSE FIX: toJSValue gave us plain JS point arrays, not native handles.
  // Calling invoke(CONTOUR_AREA, jsArray) returned 0 silently for every contour.
  // Fix: Shoelace formula for area, perimeter summation, Douglas-Peucker for approx.
  let bestQuad: Quadrilateral | null = null;
  let maxArea = 0;
  const frameArea = width * height;

  for (const contour of rawContours) {
    if (!contour || !Array.isArray(contour) || contour.length < 4) continue;

    const area = shoelaceArea(contour);
    if (area < frameArea * 0.08) continue;

    const peri = perimeter(contour);
    const approx = douglasPeucker(contour, 0.02 * peri);

    if (approx.length < 4) continue;

    if (area > maxArea) {
      maxArea = area;
      bestQuad = approx.length === 4 ? orderPoints(approx) : extractBestQuad(approx);
    }
  }

  // Release all OpenCV mats — contour work is done in JS
  safeCleanup();

  // ── Motion & readiness ────────────────────────────────────────────────────────
  const currentPoints = bestQuad
    ? [bestQuad.topLeft, bestQuad.topRight, bestQuad.bottomRight, bestQuad.bottomLeft]
    : [];
  const motionLevel = calculateMotion(currentPoints, lastPoints);
  lastPoints = currentPoints;

  const areaRatio = maxArea / frameArea;
  // Lowered isSharp threshold — entropy heuristic scores differently from Laplacian
  const isSharp   = sharpnessScore > 30;
  const isStable  = motionLevel < 25;
  const isLarge   = areaRatio > 0.08;

  let captureReadiness = 0;
  let areaScore = 0;
  let rectangularityScore = 0;
  let confidence = 0;

  if (bestQuad) {
    captureReadiness = 20;
    if (isSharp)  captureReadiness += 30;
    if (isLarge)  captureReadiness += 20;
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
  const syntheticStable = !bestQuad && sharpnessScore > 15;

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
  let maxIdx  = 0;
  const start = pts[0];
  const end   = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = perpendicularDistance(pts[i], start, end);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left  = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
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
 * From a polygon with > 4 points, extract the 4 most corner-like points.
 * Uses the 4 extremes: topmost, bottommost, leftmost, rightmost.
 */
function extractBestQuad(points: Point[]): Quadrilateral {
  let top    = points[0], bottom = points[0];
  let left   = points[0], right  = points[0];

  for (const p of points) {
    if (p.y < top.y)    top    = p;
    if (p.y > bottom.y) bottom = p;
    if (p.x < left.x)  left   = p;
    if (p.x > right.x)  right  = p;
  }

  // Map to quad: approximate TL/TR/BR/BL from extremes
  return {
    topLeft:     { x: left.x,   y: top.y    },
    topRight:    { x: right.x,  y: top.y    },
    bottomRight: { x: right.x,  y: bottom.y },
    bottomLeft:  { x: left.x,   y: bottom.y },
  };
}

/**
 * Convert an image file to grayscale using OpenCV and save to a new file.
 * Returns the URI of the grayscale file.
 * Falls back to the original URI if OpenCV conversion fails.
 */
export async function convertToGrayscale(imageUri: string): Promise<string> {
  let srcMat: any = null;
  let grayMat: any = null;
  let resizedUri: string | null = null;

  try {
    // 1. Resize and get base64 in one native step
    const resized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1200 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    
    if (!resized.base64) throw new Error('No base64 returned from image manipulator');
    resizedUri = resized.uri;

    // 2. Decode base64 to Mat
    srcMat = OpenCV.base64ToMat(resized.base64);

    // 3. Grayscale conversion via color converter
    grayMat = OpenCV.createObject(ObjectType.Mat, resized.height, resized.width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('cvtColor', srcMat, grayMat, 6); // COLOR_RGBA2GRAY = 6

    // 4. Save directly using the high-performance native saver
    const destFilename = `bw_${Date.now()}.jpg`;
    const dest = new File(Paths.document, destFilename);
    OpenCV.saveMatToFile(grayMat, dest.uri, 'jpeg', 0.9);

    // Verify file exists
    if (!dest.exists) throw new Error('Grayscale output file was not created');

    // Safe cleanup of temporary resized image
    try {
      if (resizedUri && resizedUri !== imageUri) {
        new File(resizedUri).delete();
      }
    } catch (_) {}

    return dest.uri;
  } catch (err) {
    console.warn('[CV] convertToGrayscale failed, keeping color:', err);
    return imageUri; // safe color fallback
  } finally {
    cleanupMats([srcMat, grayMat]);
    try {
      OpenCV.clearBuffers();
    } catch (_) {}
  }
}
