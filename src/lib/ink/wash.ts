import { mulberry32, r1 } from "./rng";

type Point = [number, number];

/**
 * A smooth closed path through `points`: Catmull-Rom turned into cubic Béziers,
 * so a handful of jittered points read as one soft, uneven edge.
 */
export function closedCurve(points: Point[]): string {
  const n = points.length;
  if (n < 3) return "";
  const at = (i: number) => points[(i + n) % n];
  let d = `M${r1(points[0][0])} ${r1(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return `${d}Z`;
}

export interface WashShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  seed: number;
}

/**
 * A watercolour blob: an ellipse whose radius wanders by up to ±`wobble` from
 * point to point. The same seed always gives the same blob.
 */
export function washPath({ cx, cy, rx, ry, seed }: WashShape, wobble = 0.16, count = 9): string {
  const rand = mulberry32(seed);
  const start = rand() * Math.PI * 2;
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = start + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const k = 1 + (rand() * 2 - 1) * wobble;
    points.push([cx + Math.cos(angle) * rx * k, cy + Math.sin(angle) * ry * k]);
  }
  return closedCurve(points);
}

/**
 * The darker rim watercolour leaves where the pigment dries: a second blob from
 * the next seed, a touch larger, stroked faintly over the first.
 */
export function washEdgePath(shape: WashShape): string {
  return washPath(
    { ...shape, rx: shape.rx * 1.03, ry: shape.ry * 1.03, seed: shape.seed + 1 },
    0.14
  );
}
