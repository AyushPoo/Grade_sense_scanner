import * as ImageManipulator from 'expo-image-manipulator';

export interface CVProcessingResult {
  isDocumentDetected: boolean;
  sharpnessScore: number;
  motionLevel: number;
  isStable: boolean;
  quadrilateral: null | any;
  dimensions?: { width: number; height: number };
}

export async function detectDocumentInFrame(base64Image: string): Promise<CVProcessingResult> {
  // PURE JS STABILIZATION: Native CV disabled to prevent crashes
  return {
    isDocumentDetected: false,
    sharpnessScore: 0,
    motionLevel: 0,
    isStable: false,
    quadrilateral: null
  };
}

export async function nativeProcessImage(
  base64OrUri: string, 
  options: { 
    targetWidth: number,
    grayscale?: boolean,
    autoCrop?: boolean,
    enhance?: boolean
  }
): Promise<{ base64: string }> {
  try {
    const uri = base64OrUri.startsWith('data:') || base64OrUri.startsWith('file://') 
      ? base64OrUri 
      : `data:image/jpeg;base64,${base64OrUri}`;

    // STABILITY: Use ONLY ImageManipulator for the pipeline
    // No native OpenCV calls allowed to prevent real-device crashes
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: options.targetWidth } }],
      { 
        compress: 0.9, // Higher quality for the base image
        format: ImageManipulator.SaveFormat.JPEG, 
        base64: true 
      }
    );

    let finalBase64 = resized.base64 || '';

    // REAL ENHANCEMENT: Call backend OpenCV for the "scan" look
    if (options.enhance && finalBase64) {
      try {
        console.log('[CV] Requesting real backend enhancement...');
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
        
        const response = await fetch(`${backendUrl}/api/scan-sessions/enhance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: finalBase64 })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.enhanced_image) {
            console.log('[CV] Real backend enhancement successful');
            finalBase64 = data.enhanced_image;
          }
        } else {
          console.warn('[CV] Backend enhancement failed, using resized original');
        }
      } catch (err) {
        console.error('[CV] Enhancement network error:', err);
      }
    }

    console.log('[CV] Image pipeline complete');
    return { base64: finalBase64 };
  } catch (e) {
    console.error('[CV] Pure-JS processing failed:', e);
    // Ultimate fallback: return what we were given
    return { base64: base64OrUri };
  }
}
