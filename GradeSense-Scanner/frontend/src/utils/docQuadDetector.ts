import { NativeModules, Platform } from 'react-native';
import type { Quadrilateral } from './cvProcessor';

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
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && typeof point.y === 'number';
}

function isQuadrilateral(value: unknown): value is Quadrilateral {
  if (!value || typeof value !== 'object') return false;
  const quad = value as Partial<Quadrilateral>;
  return (
    isPoint(quad.topLeft) &&
    isPoint(quad.topRight) &&
    isPoint(quad.bottomRight) &&
    isPoint(quad.bottomLeft)
  );
}

export async function detectDocumentWithDocQuad(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  if (Platform.OS !== 'android' || !nativeDocQuad?.detect) return null;

  const result = await nativeDocQuad.detect(imageUri);
  if (!result?.detected || !isQuadrilateral(result.quadrilateral)) return null;

  const width = typeof result.width === 'number' ? result.width : 0;
  const height = typeof result.height === 'number' ? result.height : 0;
  if (width <= 0 || height <= 0) return null;

  return {
    quadrilateral: result.quadrilateral,
    confidence: typeof result.confidence === 'number' ? result.confidence : undefined,
    source: 'docquad',
    dimensions: { width, height },
  };
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

  try {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', {
      uri: imageUri,
      name: 'detect_capture.jpg',
      type: 'image/jpeg',
    });

    const response = await fetch(`${doctrUrl}/detect-corners`, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
      },
    });

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
    console.warn('[DocAligner] Backend corner detection failed:', err);
    return null;
  }
}

export async function detectDocumentCorners(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  // 1. Try DocAligner on backend first
  const docAlignerResult = await detectDocumentWithDocAligner(imageUri);
  if (docAlignerResult) {
    return docAlignerResult;
  }
  
  // 2. Fall back to local native DocQuad
  return await detectDocumentWithDocQuad(imageUri);
}
