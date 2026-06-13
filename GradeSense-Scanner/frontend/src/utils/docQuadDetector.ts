import { NativeModules, Platform } from 'react-native';
import type { Quadrilateral } from './cvProcessor';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { fetchWithTimeout } from './fetchWithTimeout';

interface NativeDocQuadResult {
  detected?: boolean;
  confidence?: number;
  source?: string;
  width?: number;
  height?: number;
  quadrilateral?: Quadrilateral;
}

export interface DocQuadDetectionResult {
  quadrilateral: Quadrilateral;
  confidence?: number;
  source: 'docquad';
  dimensions: { width: number; height: number };
}

export interface TextBlockDiagnostic {
  text: string;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
  cornerPoints?: Array<{ x: number; y: number }>;
}

export interface TextOrientationAndBoundsResult {
  rotationNeeded: 0 | 90 | 180 | 270;
  hasText: boolean;
  width: number;
  height: number;
  textBounds: { left: number; top: number; right: number; bottom: number };
  blocks: TextBlockDiagnostic[];
}

const nativeDocQuad = NativeModules.GradeSenseDocQuad as
  | {
      detect: (imageUri: string) => Promise<NativeDocQuadResult>;
      detectTextOrientationAndBounds: (imageUri: string) => Promise<TextOrientationAndBoundsResult>;
    }
  | undefined;

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    'y' in value &&
    typeof (value as any).x === 'number' &&
    typeof (value as any).y === 'number'
  );
}

function isQuadrilateral(value: unknown): value is Quadrilateral {
  return (
    typeof value === 'object' &&
    value !== null &&
    'topLeft' in value &&
    'topRight' in value &&
    'bottomRight' in value &&
    'bottomLeft' in value &&
    isPoint((value as any).topLeft) &&
    isPoint((value as any).topRight) &&
    isPoint((value as any).bottomRight) &&
    isPoint((value as any).bottomLeft)
  );
}

export async function detectDocumentWithDocQuad(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  if (Platform.OS !== 'android' || !nativeDocQuad) return null;
  try {
    const res = await nativeDocQuad.detect(imageUri);
    if (!res?.detected || !res.quadrilateral) {
      return null;
    }
    return {
      quadrilateral: res.quadrilateral,
      confidence: res.confidence,
      source: 'docquad',
      dimensions: { width: res.width ?? 0, height: res.height ?? 0 },
    };
  } catch (err) {
    console.warn('[DocQuad] Native corner detection failed:', err);
    return null;
  }
}

export async function detectTextOrientationAndBounds(
  imageUri: string
): Promise<TextOrientationAndBoundsResult | null> {
  if (Platform.OS !== 'android' || !nativeDocQuad?.detectTextOrientationAndBounds) return null;
  try {
    return await nativeDocQuad.detectTextOrientationAndBounds(imageUri);
  } catch (err) {
    console.warn('[detectTextOrientationAndBounds] Native call failed:', err);
    return null;
  }
}

export async function detectDocumentWithDocAligner(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  const doctrUrl = process.env.EXPO_PUBLIC_DOCTR_URL;
  if (!doctrUrl) {
    console.log('[DocAligner] EXPO_PUBLIC_DOCTR_URL not set. Skipping backend detection.');
    return null;
  }

  let uploadUri = imageUri;
  let manipulated: ImageManipulator.ImageResult | null = null;
  
  try {
    // Downscale image to max width 720px before upload to reduce payload size and latency.
    // This reduces file size from 5-10MB to ~60KB, making network transmission instant.
    manipulated = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 720 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    uploadUri = manipulated.uri;
  } catch (err) {
    console.warn('[DocAligner] Failed to downscale image for upload:', err);
  }

  try {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', {
      uri: uploadUri,
      name: 'detect_capture.jpg',
      type: 'image/jpeg',
    });

    const response = await fetchWithTimeout(`${doctrUrl}/detect-corners`, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
      },
    }, 1500);

    // Clean up temporary downscaled file immediately after sending the request
    if (manipulated) {
      try {
        const fileObj = new File(manipulated.uri);
        if (fileObj.exists) {
          fileObj.delete();
        }
      } catch (delErr) {
        console.warn('[DocAligner] Failed to delete temp upload file:', delErr);
      }
    }

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const result = await response.json();
    if (!result?.detected || !result?.corners) {
      return null;
    }

    return {
      quadrilateral: result.corners,
      confidence: result.confidence ?? 0.95,
      source: 'docquad',
      dimensions: { width: result.width, height: result.height },
    };
  } catch (err) {
    // Clean up temporary downscaled file on error
    if (manipulated) {
      try {
        const fileObj = new File(manipulated.uri);
        if (fileObj.exists) {
          fileObj.delete();
        }
      } catch (_) {}
    }
    console.warn('[DocAligner] Backend corner detection failed:', err);
    return null;
  }
}

export async function detectDocumentCorners(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  // 1. Try local native DocQuad first (Fast, runs on device)
  const localRes = await detectDocumentWithDocQuad(imageUri);
  if (localRes) {
    return localRes;
  }
  
  // 2. Fall back to DocAligner on backend if local fails
  return await detectDocumentWithDocAligner(imageUri);
}

