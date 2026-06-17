import { NativeModules, Platform } from 'react-native';
import type { Quadrilateral } from './cvProcessor';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getNetworkQuality } from './networkUtils';
import * as Sentry from '@sentry/react-native';

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

/**
 * fetchWithRetry — wraps fetchWithTimeout with a 2-attempt retry loop.
 * Waits 500 ms between attempts. Throws the last error if both attempts fail.
 */
async function fetchWithRetry(
  url: string,
  body: FormData,
  timeoutMs: number
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        { method: 'POST', body, headers: { Accept: 'application/json' } },
        timeoutMs
      );
      if (response.ok) return response;
      // Non-2xx responses: treat as retriable
      lastErr = new Error(`DocAligner returned status ${response.status} on attempt ${attempt}`);
      console.warn(`[DocAligner] Attempt ${attempt} got HTTP ${response.status}. ${attempt < 2 ? 'Retrying...' : 'Giving up.'}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[DocAligner] Attempt ${attempt} failed:`, err, attempt < 2 ? '— retrying in 500ms' : '— giving up');
    }
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

export async function detectDocumentWithDocAligner(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  const doctrUrl = process.env.EXPO_PUBLIC_DOCTR_URL;
  if (!doctrUrl) {
    console.log('[DocAligner] EXPO_PUBLIC_DOCTR_URL not set. Skipping backend detection.');
    return null;
  }

  // ── Network-adaptive image sizing ──────────────────────────────────────────
  // On 2G/3G, use 480px to reduce payload. On WiFi/4G, use 720px for accuracy.
  const networkQuality = await getNetworkQuality();
  const isSlowNetwork = networkQuality === '2g' || networkQuality === '3g';
  const uploadWidth = isSlowNetwork ? 480 : 720;
  if (isSlowNetwork) {
    console.log(`[DocAligner] Slow network (${networkQuality}) — using ${uploadWidth}px upload width`);
  }

  // Increase timeout on slow networks to give more room before falling back.
  // On good networks DocAligner responds in 800ms–1.5s; 6 s covers 2G uploads.
  const DOCALIGNER_TIMEOUT_MS = 6000;

  let uploadUri = imageUri;
  let manipulated: ImageManipulator.ImageResult | null = null;

  try {
    // Downscale image before upload to reduce payload size and latency.
    manipulated = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: uploadWidth } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    uploadUri = manipulated.uri;
  } catch (err) {
    console.warn('[DocAligner] Failed to downscale image for upload:', err);
  }

  const cleanup = () => {
    if (manipulated) {
      try {
        const fileObj = new File(manipulated!.uri);
        if (fileObj.exists) fileObj.delete();
      } catch (_) {}
    }
  };

  try {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', {
      uri: uploadUri,
      name: 'detect_capture.jpg',
      type: 'image/jpeg',
    });

    const response = await fetchWithRetry(
      `${doctrUrl}/detect-corners`,
      formData,
      DOCALIGNER_TIMEOUT_MS
    );

    cleanup();

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
    cleanup();
    console.warn('[DocAligner] Backend corner detection failed after retries:', err);
    // Report to Sentry so we can track how often DocAligner fails in the field
    Sentry.captureException(err, {
      tags: { area: 'docAligner' },
      extra: { networkQuality, uploadWidth },
    });
    return null;
  }
}

export async function detectDocumentCorners(
  imageUri: string
): Promise<DocQuadDetectionResult | null> {
  // 1. Try deployed DocAligner backend first (Highly accurate, fastvit_sa24)
  const backendRes = await detectDocumentWithDocAligner(imageUri);
  if (backendRes) {
    return backendRes;
  }

  // 2. Fall back to local native DocQuad if backend fails or offline
  return await detectDocumentWithDocQuad(imageUri);
}
