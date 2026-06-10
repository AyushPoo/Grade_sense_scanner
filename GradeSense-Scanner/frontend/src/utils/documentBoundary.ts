export interface BoundaryPoint {
  x: number;
  y: number;
}

export interface BoundaryQuadrilateral {
  topLeft: BoundaryPoint;
  topRight: BoundaryPoint;
  bottomRight: BoundaryPoint;
  bottomLeft: BoundaryPoint;
}

interface Line {
  a: BoundaryPoint;
  b: BoundaryPoint;
  shift: number;
}

const EDGE_SEARCH_RATIO = 0.065;
const MAX_OUTWARD_SNAP_RATIO = 0.045;
const MAX_INWARD_SNAP_RATIO = 0.012;
const MIN_EDGE_SUPPORT = 3;

function pointsOf(quad: BoundaryQuadrilateral): BoundaryPoint[] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

function signedArea(points: BoundaryPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return area / 2;
}

function cross(a: BoundaryPoint, b: BoundaryPoint, c: BoundaryPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isConvex(points: BoundaryPoint[]): boolean {
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < points.length; i += 1) {
    const value = cross(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length]);
    if (value > 0) positive += 1;
    if (value < 0) negative += 1;
  }
  return positive === points.length || negative === points.length;
}

function clampPoint(point: BoundaryPoint, width: number, height: number): BoundaryPoint {
  return {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
}

function signedDistanceToLine(point: BoundaryPoint, a: BoundaryPoint, b: BoundaryPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return 0;
  return ((point.x - a.x) * dy - (point.y - a.y) * dx) / len;
}

function projectionRatio(point: BoundaryPoint, a: BoundaryPoint, b: BoundaryPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = dx * dx + dy * dy;
  if (denom <= 0) return 0;
  return ((point.x - a.x) * dx + (point.y - a.y) * dy) / denom;
}

function offsetPoint(point: BoundaryPoint, a: BoundaryPoint, b: BoundaryPoint, distance: number): BoundaryPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return point;
  return {
    x: point.x + (dy / len) * distance,
    y: point.y - (dx / len) * distance,
  };
}

function shiftedLine(a: BoundaryPoint, b: BoundaryPoint, shift: number): Line {
  return {
    a: offsetPoint(a, a, b, shift),
    b: offsetPoint(b, a, b, shift),
    shift,
  };
}

function intersectLines(first: Line, second: Line): BoundaryPoint | null {
  const x1 = first.a.x;
  const y1 = first.a.y;
  const x2 = first.b.x;
  const y2 = first.b.y;
  const x3 = second.a.x;
  const y3 = second.a.y;
  const x4 = second.b.x;
  const y4 = second.b.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 0.0001) return null;

  return {
    x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom,
    y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom,
  };
}

function edgeShift(
  a: BoundaryPoint,
  b: BoundaryPoint,
  points: BoundaryPoint[],
  frameShortSide: number,
): number {
  const searchDistance = frameShortSide * EDGE_SEARCH_RATIO;
  const maxOutward = frameShortSide * MAX_OUTWARD_SNAP_RATIO;
  const maxInward = frameShortSide * MAX_INWARD_SNAP_RATIO;
  const nearby: number[] = [];

  for (const point of points) {
    const projection = projectionRatio(point, a, b);
    if (projection < -0.08 || projection > 1.08) continue;
    const distance = signedDistanceToLine(point, a, b);
    if (Math.abs(distance) <= searchDistance) {
      nearby.push(distance);
    }
  }

  if (nearby.length < MIN_EDGE_SUPPORT) return 0;

  nearby.sort((left, right) => left - right);
  const outward = nearby[Math.min(nearby.length - 1, Math.floor(nearby.length * 0.88))];
  return Math.max(-maxInward, Math.min(maxOutward, outward));
}

function isSaneRefinement(
  original: BoundaryQuadrilateral,
  refined: BoundaryQuadrilateral,
  width: number,
  height: number,
): boolean {
  const originalPoints = pointsOf(original);
  const refinedPoints = pointsOf(refined);
  if (!isConvex(refinedPoints)) return false;
  if (Math.abs(signedArea(refinedPoints)) < width * height * 0.08) return false;

  const maxCornerMove = Math.hypot(width, height) * 0.12;
  for (let i = 0; i < refinedPoints.length; i += 1) {
    const movement = Math.hypot(
      refinedPoints[i].x - originalPoints[i].x,
      refinedPoints[i].y - originalPoints[i].y,
    );
    if (movement > maxCornerMove) return false;
  }

  return true;
}

export function refineQuadWithBoundaryPoints(
  quad: BoundaryQuadrilateral,
  boundaryPoints: BoundaryPoint[],
  dimensions: { width: number; height: number },
): BoundaryQuadrilateral {
  if (boundaryPoints.length < 12 || dimensions.width <= 0 || dimensions.height <= 0) {
    return quad;
  }

  const originalPoints = pointsOf(quad);
  const frameShortSide = Math.min(dimensions.width, dimensions.height);
  const lines = originalPoints.map((point, index) => {
    const next = originalPoints[(index + 1) % originalPoints.length];
    return shiftedLine(point, next, edgeShift(point, next, boundaryPoints, frameShortSide));
  });

  const topLeft = intersectLines(lines[3], lines[0]);
  const topRight = intersectLines(lines[0], lines[1]);
  const bottomRight = intersectLines(lines[1], lines[2]);
  const bottomLeft = intersectLines(lines[2], lines[3]);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return quad;

  const refined: BoundaryQuadrilateral = {
    topLeft: clampPoint(topLeft, dimensions.width, dimensions.height),
    topRight: clampPoint(topRight, dimensions.width, dimensions.height),
    bottomRight: clampPoint(bottomRight, dimensions.width, dimensions.height),
    bottomLeft: clampPoint(bottomLeft, dimensions.width, dimensions.height),
  };

  return isSaneRefinement(quad, refined, dimensions.width, dimensions.height) ? refined : quad;
}
