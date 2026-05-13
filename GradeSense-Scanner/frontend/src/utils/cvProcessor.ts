import * as ImageManipulator from 'expo-image-manipulator';
import { OpenCV, ObjectType, DataTypes } from 'react-native-fast-opencv';

export interface CVProcessingResult {
  isDocumentDetected: boolean;
  sharpnessScore: number;
  motionLevel: number;
  isStable: boolean;
  quadrilateral: null | Quadrilateral;
  dimensions?: { width: number; height: number };
  captureReadiness: number; // 0-100 score
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

/**
 * Real-time document detection using native OpenCV via JSI
 */
export async function detectDocumentInFrame(
  base64Image: string,
  width: number,
  height: number
): Promise<CVProcessingResult> {
  const startTime = Date.now();
  try {
    // 1. Convert base64 to Mat
    const mat = OpenCV.base64ToMat(base64Image);
    
    // 2. Pre-processing pipeline
    const gray = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke('cvtColor', mat, gray, COLOR_RGBA2GRAY);
    
    // 3. Real Sharpness Scoring (Laplacian Variance)
    const laplacian = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    // STABILITY FIX: Pass all 7 parameters required by native Laplacian implementation
    // src, dst, ddepth, ksize, scale, delta, borderType
    (OpenCV as any).invoke('Laplacian', gray, laplacian, 3, 1, 1, 0, 4); 
    
    const meanMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    const stddevMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    (OpenCV as any).invoke('meanStdDev', laplacian, meanMat, stddevMat);
    
    // Extract standard deviation value
    const stddevRaw: any = OpenCV.toJSValue(stddevMat);
    const stddevArray = stddevRaw?.array || stddevRaw;
    const sharpnessScore = Math.pow(Array.isArray(stddevArray) ? stddevArray[0] : 0, 2); 
    
    // 4. Document Detection
    const blurred = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    // STABILITY FIX: Use native Size object instead of plain JS object
    const ksize = OpenCV.createObject(ObjectType.Size, 5, 5);
    (OpenCV as any).invoke(GAUSSIAN_BLUR, gray, blurred, ksize, 0);
    
    const edged = OpenCV.createObject(ObjectType.Mat, height, width, DataTypes.CV_8UC1);
    (OpenCV as any).invoke(CANNY, blurred, edged, 75, 200);
    
    const contoursData = OpenCV.createObject(ObjectType.PointVectorOfVectors);
    (OpenCV as any).invoke(FIND_CONTOURS, edged, contoursData, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);
    const contoursRaw: any = OpenCV.toJSValue(contoursData);
    const contours = contoursRaw?.array || contoursRaw;
    
    let bestQuad: Quadrilateral | null = null;
    let maxArea = 0;
    
    const frameArea = width * height;
    
    if (contours && Array.isArray(contours)) {
      for (let i = 0; i < contours.length; i++) {
        const contour = contours[i];
        const area = (OpenCV as any).invoke(CONTOUR_AREA, contour);
        
        // Filter out small noise (must be at least 15% of frame)
        if (area < frameArea * 0.15) continue;
        
        const peri = (OpenCV as any).invoke(ARC_LENGTH, contour, true);
        const approxData = OpenCV.createObject(ObjectType.PointVector);
        (OpenCV as any).invoke(APPROX_POLY_DP, contour, approxData, 0.02 * peri, true);
        const approxRaw: any = OpenCV.toJSValue(approxData);
        const approx = approxRaw?.array || approxRaw;
        
        if (approx && Array.isArray(approx) && approx.length === 4) {
          if (area > maxArea) {
            maxArea = area;
            bestQuad = orderPoints(approx);
          }
        }
      }
    }

    // 5. Calculate stability/motion
    const currentPoints = bestQuad ? [bestQuad.topLeft, bestQuad.topRight, bestQuad.bottomRight, bestQuad.bottomLeft] : [];
    const motionLevel = calculateMotion(currentPoints, lastPoints);
    lastPoints = currentPoints;

    // 6. Final Readiness Score
    // Criteria: detected, sharp enough (>50), large enough (>25% frame), stable (<10px drift)
    const areaRatio = maxArea / frameArea;
    const isSharp = sharpnessScore > 50;
    const isStable = motionLevel < 15;
    const isLarge = areaRatio > 0.25;

    let captureReadiness = 0;
    if (bestQuad) {
      captureReadiness = 20; // Detected base
      if (isSharp) captureReadiness += 30;
      if (isLarge) captureReadiness += 20;
      if (isStable) captureReadiness += 30;
    }

    // MEMORY MANAGEMENT: Clear buffers
    OpenCV.clearBuffers();

    return {
      isDocumentDetected: !!bestQuad,
      sharpnessScore,
      motionLevel,
      isStable,
      quadrilateral: bestQuad,
      dimensions: { width, height },
      captureReadiness
    };
  } catch (err) {
    console.error('[CV] Real-time processing failed:', err.message);
    OpenCV.clearBuffers();
    return {
      isDocumentDetected: false,
      sharpnessScore: 0,
      motionLevel: 0,
      isStable: false,
      quadrilateral: null,
      captureReadiness: 0
    };
  }
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
            const enhancedFile = new FileSystem.File(FileSystem.Paths.document, `proc_${Date.now()}.jpg`);
            await enhancedFile.writeAsString(data.enhanced_image, {
              encoding: FileSystem.EncodingType.Base64,
            });
            
            // CLEANUP: Delete the intermediate resized image to save space
            try {
              const resizedFile = new FileSystem.File(resized.uri);
              await resizedFile.delete();
            } catch (e) {
              console.warn('[Cleanup] Failed to delete temp resized image:', e);
            }
            
            finalUri = enhancedFile.uri;
            console.log('[ISOLATION] FileSystem.writeAsString: SUCCESS');
          }
        }
      } catch (err) {
        console.warn('[ISOLATION] Binary enhancement fallback:', err.message);
      }
    }

    return { uri: finalUri };
  } catch (e) {
    console.error('[CV] Processing failed:', e);
    return { uri: imageUri };
  }
}
