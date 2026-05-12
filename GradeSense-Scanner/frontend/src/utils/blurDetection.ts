import * as ImageManipulator from 'expo-image-manipulator';

// Threshold for blur detection
export const BLUR_THRESHOLD = 100;

// Sharpness levels for user feedback
export type SharpnessLevel = 'sharp' | 'acceptable' | 'blurry' | 'very_blurry';

export interface BlurDetectionResult {
  isBlurry: boolean;
  sharpnessScore: number;
  level: SharpnessLevel;
  message: string;
}

/**
 * Detects image blur.
 * STABILITY: Pure JS fallback only. Native OpenCV is disabled to prevent crashes.
 */
export async function detectBlur(imageUri: string): Promise<BlurDetectionResult> {
  try {
    // 1. Resize image for analysis
    const smallImage = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 200 } }],
      { format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    if (!smallImage.base64) throw new Error('Failed to get image data');

    // 2. Use Heuristic Sharpness (Pure JS)
    const sharpnessScore = calculateHeuristicSharpness(smallImage.base64);
    const level = getSharpnessLevel(sharpnessScore);
    
    return {
      isBlurry: sharpnessScore < 40,
      sharpnessScore,
      level,
      message: getBlurMessage(level),
    };
  } catch (error) {
    console.error('[Blur] Analysis error:', error);
    return {
      isBlurry: false,
      sharpnessScore: 100,
      level: 'acceptable',
      message: 'Analysis unavailable',
    };
  }
}

function calculateHeuristicSharpness(base64: string): number {
  // Heuristic based on entropy/file size ratio
  const dataLength = base64.length;
  const estimatedPixels = 200 * 150;
  const dataPerPixel = dataLength / estimatedPixels;
  // Scale to match typical Laplacian scores roughly
  return Math.round(dataPerPixel * 80); 
}

function getSharpnessLevel(score: number): SharpnessLevel {
  if (score >= 150) return 'sharp';
  if (score >= 80) return 'acceptable';
  if (score >= 40) return 'blurry';
  return 'very_blurry';
}

function getBlurMessage(level: SharpnessLevel): string {
  switch (level) {
    case 'sharp': return 'Perfectly sharp';
    case 'acceptable': return 'Good quality';
    case 'blurry': return 'Slightly blurry';
    case 'very_blurry': return 'Too blurry - retake';
  }
}

export async function isImageBlurry(imageUri: string): Promise<boolean> {
  const result = await detectBlur(imageUri);
  return result.isBlurry;
}

export function getSharpnessColor(level: SharpnessLevel): string {
  switch (level) {
    case 'sharp': return '#22C55E';
    case 'acceptable': return '#84CC16';
    case 'blurry': return '#F59E0B';
    case 'very_blurry': return '#EF4444';
  }
}
