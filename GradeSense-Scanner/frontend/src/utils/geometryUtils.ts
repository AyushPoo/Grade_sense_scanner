import { Quadrilateral } from './cvProcessor';

function crossProduct(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }): number {
  return (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
}

export function hasConsistentWinding(q: Quadrilateral): boolean {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  let pos = 0;
  let neg = 0;
  
  for (let i = 0; i < 4; i++) {
    const cp = crossProduct(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]);
    if (cp > 0) pos++;
    else if (cp < 0) neg++;
  }
  
  // All cross products must share the same sign.
  // This inherently prevents concave polygons, hourglass crossing, and edge inversion.
  return pos === 4 || neg === 4;
}

export function isConvexQuad(q: Quadrilateral): boolean {
  return hasConsistentWinding(q);
}

export function minimumEdgeLengthValid(
  q: Quadrilateral, 
  minRatio: number, 
  containerWidth: number, 
  containerHeight: number
): boolean {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  const shortestSide = Math.min(containerWidth, containerHeight);
  const minLen = shortestSide * minRatio;

  for (let i = 0; i < 4; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % 4];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist < minLen) return false;
  }
  return true;
}
