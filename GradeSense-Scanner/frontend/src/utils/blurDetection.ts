import * as ImageManipulator from 'expo-image-manipulator';

export type SharpnessLevel = 'sharp' | 'acceptable' | 'blurry' | 'very_blurry';

export interface BlurDetectionResult {
  isBlurry: boolean;
  sharpnessScore: number; // 0–100 normalized
  level: SharpnessLevel;
  message: string;
}

/**
 * Detects image blur using a pure-JS JPEG entropy heuristic.
 *
 * HOW IT WORKS:
 * Sharp images have high-frequency detail → JPEG compresses less efficiently →
 * larger file size per pixel. Blurry images have smooth gradients → JPEG
 * compresses very efficiently → smaller file size per pixel.
 *
 * We measure bytes-per-pixel of the base64-encoded JPEG at a fixed small size,
 * then normalize to a 0–100 score where 100 = very sharp, 0 = very blurry.
 *
 * CALIBRATION (empirically measured on 400×300px JPEGs at quality=80):
 *   Very blurry full-res resized to 400px: ~15–25KB → bpp ≈ 0.10–0.16
 *   Acceptable capture resized to 400px:   ~25–50KB → bpp ≈ 0.16–0.31
 *   Sharp document resized to 400px:       ~40–80KB → bpp ≈ 0.25–0.50
 *
 * Normalized: score = clamp((bpp - 0.08) / (0.55 - 0.08) * 100, 0, 100)
 */

// FIX: 200px at compress:0.8 on a 4000px phone image → bpp≈0.25, below old BPP_MIN=0.5 → always score 0.
// At 400px the image retains more detail; the 0.08–0.55 range covers the actual bpp of phone captures.
const ANALYSIS_WIDTH = 400;             // was 200 — larger sample keeps more high-freq detail
const ESTIMATED_HEIGHT = 300;           // 4:3 ratio at 400px (was 150)
const ESTIMATED_PIXELS = ANALYSIS_WIDTH * ESTIMATED_HEIGHT;  // 120,000 (was 30,000)

// Calibration anchors — recalibrated for full-res → 400px at compress:0.8
const BPP_MIN = 0.08;  // floor: very blurry full-res image resized to 400px (was 0.5)
const BPP_MAX = 0.55;  // ceiling: sharp document resized to 400px (was 6.0)

// Score thresholds for level classification (0–100 scale) — unchanged
const THRESHOLD_SHARP      = 65; // ≥65 → sharp
const THRESHOLD_ACCEPTABLE = 35; // ≥35 → acceptable
const THRESHOLD_BLURRY     = 15; // ≥15 → blurry, <15 → very_blurry

// isBlurry flag threshold — used by scanner to warn teacher
const BLUR_FLAG_THRESHOLD = 35; // below acceptable = flagged blurry

export async function detectBlur(imageUri: string): Promise<BlurDetectionResult> {
  try {
    const smallImage = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: ANALYSIS_WIDTH } }],
      { format: ImageManipulator.SaveFormat.JPEG, base64: true, compress: 0.8 }
    );

    if (!smallImage.base64) throw new Error('No base64 data returned');

    const sharpnessScore = calculateNormalizedSharpness(smallImage.base64);
    const level = getSharpnessLevel(sharpnessScore);

    return {
      isBlurry: sharpnessScore < BLUR_FLAG_THRESHOLD,
      sharpnessScore,
      level,
      message: getBlurMessage(level),
    };
  } catch (error) {
    console.error('[Blur] Analysis error:', error);
    // Fail-open: don't block capture on analysis failure
    return {
      isBlurry: false,
      sharpnessScore: 50,
      level: 'acceptable',
      message: 'Analysis unavailable',
    };
  }
}

/**
 * Returns a 0–100 sharpness score.
 * Higher = sharper. Calibrated to JPEG entropy heuristic.
 */
function calculateNormalizedSharpness(base64: string): number {
  // base64 encodes 3 bytes → 4 chars, so actual bytes = length * 0.75
  const actualBytes = base64.length * 0.75;
  const bytesPerPixel = actualBytes / ESTIMATED_PIXELS;

  // Normalize to 0–100
  const normalized = (bytesPerPixel - BPP_MIN) / (BPP_MAX - BPP_MIN) * 100;
  return Math.round(Math.max(0, Math.min(100, normalized)));
}

function getSharpnessLevel(score: number): SharpnessLevel {
  if (score >= THRESHOLD_SHARP)      return 'sharp';
  if (score >= THRESHOLD_ACCEPTABLE) return 'acceptable';
  if (score >= THRESHOLD_BLURRY)     return 'blurry';
  return 'very_blurry';
}

function getBlurMessage(level: SharpnessLevel): string {
  switch (level) {
    case 'sharp':      return 'Sharp';
    case 'acceptable': return 'Good quality';
    case 'blurry':     return 'Slightly blurry';
    case 'very_blurry': return 'Too blurry — retake';
  }
}

export async function isImageBlurry(imageUri: string): Promise<boolean> {
  const result = await detectBlur(imageUri);
  return result.isBlurry;
}

export function getSharpnessColor(level: SharpnessLevel): string {
  switch (level) {
    case 'sharp':      return '#22C55E';
    case 'acceptable': return '#84CC16';
    case 'blurry':     return '#F59E0B';
    case 'very_blurry': return '#EF4444';
  }
}
