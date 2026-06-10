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

const nativeDocQuad = NativeModules.GradeSenseDocQuad as
  | { detect: (imageUri: string) => Promise<NativeDocQuadResult> }
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
