import type { Quadrilateral } from './cvProcessor';

type CropRejectReason =
  | 'invalid_dimensions'
  | 'non_finite_point'
  | 'out_of_bounds'
  | 'border_hugging'
  | 'non_convex'
  | 'area_too_small'
  | 'bbox_too_small'
  | 'low_rectangularity'
  | 'edge_ratio'
  | 'diagonal_ratio'
  | 'angle_outlier'
  | 'low_confidence'
  | 'low_area_score'
  | 'text_cut_off';

export interface CropQualityMetrics {
  areaRatio: number;
  bboxWidthRatio: number;
  bboxHeightRatio: number;
  rectangularity: number;
  maxEdgeRatio: number;
  oppositeEdgeRatio: number;
  diagonalRatio: number;
  minAngle: number;
  maxAngle: number;
  borderPointCount: number;
}

export interface CropQualityInput {
  confidence?: number;
  areaScore?: number;
  profile?: 'standard' | 'docquad';
  textBlocks?: Array<{ left: number; top: number; right: number; bottom: number }>;
  textBlocksSourceDims?: { width: number; height: number };
}

export interface CropQualityResult {
  accepted: boolean;
  reason?: CropRejectReason;
  metrics: CropQualityMetrics;
}

const DEFAULT_METRICS: CropQualityMetrics = {
  areaRatio: 0,
  bboxWidthRatio: 0,
  bboxHeightRatio: 0,
  rectangularity: 0,
  maxEdgeRatio: Infinity,
  oppositeEdgeRatio: Infinity,
  diagonalRatio: Infinity,
  minAngle: 0,
  maxAngle: 180,
  borderPointCount: 0,
};

const BOUNDS_TOLERANCE_RATIO = 0.035;
const BORDER_HUG_TOLERANCE_RATIO = 0.005;
const MIN_AREA_RATIO = 0.20;
const MIN_BBOX_WIDTH_RATIO = 0.40;
const MIN_BBOX_HEIGHT_RATIO = 0.40;
const MIN_RECTANGULARITY = 0.60;
const MAX_EDGE_RATIO = 3.0;
const MAX_OPPOSITE_EDGE_RATIO = 1.75;
const MAX_DIAGONAL_RATIO = 1.55;
const MIN_CORNER_ANGLE = 42;
const MAX_CORNER_ANGLE = 138;
const MIN_CONFIDENCE = 0.58;
const MIN_AREA_SCORE = 0.3;

const DOCQUAD_BOUNDS_TOLERANCE_RATIO = 0.12;
const DOCQUAD_MIN_AREA_RATIO = 0.08;
const DOCQUAD_MIN_BBOX_WIDTH_RATIO = 0.28;
const DOCQUAD_MIN_BBOX_HEIGHT_RATIO = 0.28;
const DOCQUAD_MIN_RECTANGULARITY = 0.42;
const DOCQUAD_MAX_EDGE_RATIO = 4.25;
const DOCQUAD_MAX_OPPOSITE_EDGE_RATIO = 2.6;
const DOCQUAD_MAX_DIAGONAL_RATIO = 2.05;
const DOCQUAD_MIN_CORNER_ANGLE = 28;
const DOCQUAD_MAX_CORNER_ANGLE = 152;
const DOCQUAD_MIN_CONFIDENCE = 0.48;

function pointsOf(q: Quadrilateral) {
  return [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function cross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

function isConvex(points: { x: number; y: number }[]): boolean {
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < points.length; i++) {
    const value = cross(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length]);
    if (value > 0) positive++;
    if (value < 0) negative++;
  }
  return positive === points.length || negative === points.length;
}

function angle(
  previous: { x: number; y: number },
  current: { x: number; y: number },
  next: { x: number; y: number }
): number {
  const ax = previous.x - current.x;
  const ay = previous.y - current.y;
  const bx = next.x - current.x;
  const by = next.y - current.y;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (magA === 0 || magB === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (magA * magB)));
  return Math.acos(cosine) * 180 / Math.PI;
}

function isPointInsideQuad(p: { x: number; y: number }, quad: Quadrilateral): boolean {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let prevSign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const sign = Math.sign(cross);
    if (prevSign !== 0 && sign !== prevSign) {
      return false;
    }
    prevSign = sign;
  }
  return true;
}

export function evaluateAutoCropCandidate(
  quad: Quadrilateral | null | undefined,
  dimensions: { width: number; height: number },
  detection: CropQualityInput = {}
): CropQualityResult {
  if (!quad || dimensions.width <= 0 || dimensions.height <= 0) {
    return { accepted: false, reason: 'invalid_dimensions', metrics: DEFAULT_METRICS };
  }

  const pts = pointsOf(quad);
  if (pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { accepted: false, reason: 'non_finite_point', metrics: DEFAULT_METRICS };
  }

  const isDocQuad = detection.profile === 'docquad';
  const boundsToleranceRatio = isDocQuad ? DOCQUAD_BOUNDS_TOLERANCE_RATIO : BOUNDS_TOLERANCE_RATIO;
  const minAreaRatio = isDocQuad ? DOCQUAD_MIN_AREA_RATIO : MIN_AREA_RATIO;
  const minBboxWidthRatio = isDocQuad ? DOCQUAD_MIN_BBOX_WIDTH_RATIO : MIN_BBOX_WIDTH_RATIO;
  const minBboxHeightRatio = isDocQuad ? DOCQUAD_MIN_BBOX_HEIGHT_RATIO : MIN_BBOX_HEIGHT_RATIO;
  const minRectangularity = isDocQuad ? DOCQUAD_MIN_RECTANGULARITY : MIN_RECTANGULARITY;
  const maxEdgeRatio = isDocQuad ? DOCQUAD_MAX_EDGE_RATIO : MAX_EDGE_RATIO;
  const maxOppositeEdgeRatio = isDocQuad ? DOCQUAD_MAX_OPPOSITE_EDGE_RATIO : MAX_OPPOSITE_EDGE_RATIO;
  const maxDiagonalRatio = isDocQuad ? DOCQUAD_MAX_DIAGONAL_RATIO : MAX_DIAGONAL_RATIO;
  const minCornerAngle = isDocQuad ? DOCQUAD_MIN_CORNER_ANGLE : MIN_CORNER_ANGLE;
  const maxCornerAngle = isDocQuad ? DOCQUAD_MAX_CORNER_ANGLE : MAX_CORNER_ANGLE;
  const minConfidence = isDocQuad ? DOCQUAD_MIN_CONFIDENCE : MIN_CONFIDENCE;

  const toleranceX = dimensions.width * boundsToleranceRatio;
  const toleranceY = dimensions.height * boundsToleranceRatio;
  if (pts.some(p => p.x < -toleranceX || p.x > dimensions.width + toleranceX || p.y < -toleranceY || p.y > dimensions.height + toleranceY)) {
    return { accepted: false, reason: 'out_of_bounds', metrics: DEFAULT_METRICS };
  }

  if (!isConvex(pts)) {
    return { accepted: false, reason: 'non_convex', metrics: DEFAULT_METRICS };
  }

  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const bboxWidth = maxX - minX;
  const bboxHeight = maxY - minY;
  const bboxArea = bboxWidth * bboxHeight;
  const area = polygonArea(pts);
  const edges = pts.map((p, i) => distance(p, pts[(i + 1) % pts.length]));
  const diagonals = [distance(pts[0], pts[2]), distance(pts[1], pts[3])];
  const angles = pts.map((p, i) => angle(pts[(i + pts.length - 1) % pts.length], p, pts[(i + 1) % pts.length]));
  const borderToleranceX = dimensions.width * BORDER_HUG_TOLERANCE_RATIO;
  const borderToleranceY = dimensions.height * BORDER_HUG_TOLERANCE_RATIO;
  const borderPointCount = pts.filter(p =>
    p.x <= borderToleranceX ||
    p.x >= dimensions.width - borderToleranceX ||
    p.y <= borderToleranceY ||
    p.y >= dimensions.height - borderToleranceY
  ).length;

  const metrics: CropQualityMetrics = {
    areaRatio: area / (dimensions.width * dimensions.height),
    bboxWidthRatio: bboxWidth / dimensions.width,
    bboxHeightRatio: bboxHeight / dimensions.height,
    rectangularity: bboxArea > 0 ? area / bboxArea : 0,
    maxEdgeRatio: Math.max(...edges) / Math.max(1, Math.min(...edges)),
    oppositeEdgeRatio: Math.max(
      Math.max(edges[0], edges[2]) / Math.max(1, Math.min(edges[0], edges[2])),
      Math.max(edges[1], edges[3]) / Math.max(1, Math.min(edges[1], edges[3])),
    ),
    diagonalRatio: Math.max(...diagonals) / Math.max(1, Math.min(...diagonals)),
    minAngle: Math.min(...angles),
    maxAngle: Math.max(...angles),
    borderPointCount,
  };

  if (metrics.borderPointCount >= (isDocQuad ? 4 : 3)) return { accepted: false, reason: 'border_hugging', metrics };
  if (metrics.areaRatio < minAreaRatio) return { accepted: false, reason: 'area_too_small', metrics };
  if (metrics.bboxWidthRatio < minBboxWidthRatio || metrics.bboxHeightRatio < minBboxHeightRatio) {
    return { accepted: false, reason: 'bbox_too_small', metrics };
  }
  if (metrics.rectangularity < minRectangularity) return { accepted: false, reason: 'low_rectangularity', metrics };
  if (metrics.maxEdgeRatio > maxEdgeRatio) return { accepted: false, reason: 'edge_ratio', metrics };
  if (metrics.oppositeEdgeRatio > maxOppositeEdgeRatio) return { accepted: false, reason: 'edge_ratio', metrics };
  if (metrics.diagonalRatio > maxDiagonalRatio) return { accepted: false, reason: 'diagonal_ratio', metrics };
  if (metrics.minAngle < minCornerAngle || metrics.maxAngle > maxCornerAngle) {
    return { accepted: false, reason: 'angle_outlier', metrics };
  }
  if (detection.confidence !== undefined && detection.confidence < minConfidence) {
    return { accepted: false, reason: 'low_confidence', metrics };
  }
  if (detection.areaScore !== undefined && detection.areaScore < MIN_AREA_SCORE) {
    return { accepted: false, reason: 'low_area_score', metrics: DEFAULT_METRICS };
  }

  if (detection.textBlocks && detection.textBlocks.length > 0) {
    const srcWidth = detection.textBlocksSourceDims?.width ?? dimensions.width;
    const srcHeight = detection.textBlocksSourceDims?.height ?? dimensions.height;
    const scaleX = dimensions.width / srcWidth;
    const scaleY = dimensions.height / srcHeight;

    let cutOffCount = 0;
    for (const block of detection.textBlocks) {
      const left = block.left * scaleX;
      const right = block.right * scaleX;
      const top = block.top * scaleY;
      const bottom = block.bottom * scaleY;

      const center = {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
      };
      if (!isPointInsideQuad(center, quad)) {
        cutOffCount++;
      }
    }
    const cutOffRatio = cutOffCount / detection.textBlocks.length;
    if (cutOffRatio > 0.05 && cutOffCount >= 2) {
      return { accepted: false, reason: 'text_cut_off', metrics: DEFAULT_METRICS };
    }
  }

  return { accepted: true, metrics };
}
