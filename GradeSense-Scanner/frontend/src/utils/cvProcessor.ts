import * as ImageManipulator from 'expo-image-manipulator';

export interface CVProcessingResult {
  isDocumentDetected: boolean;
  sharpnessScore: number;
  motionLevel: number;
  isStable: boolean;
  quadrilateral: null | any;
}

export function detectDocumentInFrame(frame: any): CVProcessingResult {
  // Not used in Expo Go version, just returning a stub
  return {
    isDocumentDetected: false,
    sharpnessScore: 0,
    motionLevel: 0,
    isStable: true,
    quadrilateral: null
  };
}

export async function nativeProcessImage(
  base64OrUri: string, 
  options: { 
    targetWidth: number,
    grayscale?: boolean,
    autoCrop?: boolean
  }
): Promise<{ base64: string }> {
  try {
    // If it's pure base64 (not a uri), we need to format it for ImageManipulator
    const uri = base64OrUri.startsWith('data:') || base64OrUri.startsWith('file://') 
      ? base64OrUri 
      : `data:image/jpeg;base64,${base64OrUri}`;

    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: options.targetWidth } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    
    return { base64: manipResult.base64 || '' };
  } catch (e) {
    console.error('Safe process failed:', e);
    // If it fails, just return what we have (assuming it's base64)
    return { base64: base64OrUri };
  }
}
