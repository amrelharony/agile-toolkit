/**
 * 2D bounding box, point, and segment helpers used across the canvas.
 * World coords: +x right, +y down (HTML convention).
 *
 * Every function is pure (no mutation, no side effects) so they're safe
 * to call from useMemo and during render. AABB algorithms only — rotated
 * rectangles compute a tight AABB via {@link rotateRect} when needed.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Camera {
  /** World-space coords currently at viewport origin (0, 0 in screen). */
  x: number;
  y: number;
  /** 1 = 100%; >1 = zoomed in; <1 = zoomed out. */
  zoom: number;
}

/* ─── Conversions between world and screen space ─────────────────── */

/** Defensive read of zoom that never returns 0/NaN/Infinity. Prevents
 * downstream divisions from poisoning the camera math when the camera
 * state has been corrupted (e.g. a malformed persisted value). */
function zoomOr1(z: number): number {
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export function worldToScreen(p: Vec2, cam: Camera): Vec2 {
  const z = zoomOr1(cam.zoom);
  return { x: (p.x - cam.x) * z, y: (p.y - cam.y) * z };
}

export function screenToWorld(p: Vec2, cam: Camera): Vec2 {
  const z = zoomOr1(cam.zoom);
  return { x: p.x / z + cam.x, y: p.y / z + cam.y };
}

/** Compute the world-space rect currently visible on screen. */
export function viewportWorldRect(cam: Camera, screenW: number, screenH: number): Rect {
  const z = zoomOr1(cam.zoom);
  return {
    x: cam.x,
    y: cam.y,
    w: screenW / z,
    h: screenH / z,
  };
}

/* ─── Hit testing ─────────────────────────────────────────────────── */

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Point-on-segment with tolerance `tol` (in same units as the segment). */
export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, tol = 4): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ddx = p.x - a.x;
    const ddy = p.y - a.y;
    return ddx * ddx + ddy * ddy <= tol * tol;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const distSq = (p.x - projX) ** 2 + (p.y - projY) ** 2;
  return distSq <= tol * tol;
}

export function aabbIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function aabbContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/* ─── Construction / transformation ───────────────────────────────── */

export function inflate(r: Rect, dx: number, dy: number = dx): Rect {
  return { x: r.x - dx, y: r.y - dy, w: r.w + dx * 2, h: r.h + dy * 2 };
}

/** Tight AABB of a rect rotated `deg` degrees around its center. */
export function rotateRect(r: Rect, deg: number): Rect {
  if (deg % 360 === 0) return r;
  const rad = (deg * Math.PI) / 180;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = r.w * cos + r.h * sin;
  const h = r.w * sin + r.h * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function boundingBoxOfPoints(points: readonly Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** AABB for a flat [x0,y0,x1,y1,...] coordinate array — useful for freehand.
 *
 * Defensive against odd-length inputs (orphan trailing x with no y). The
 * validator rejects odd-length freehand arrays at ingest, but this
 * function is also called from in-progress drawing where a half-recorded
 * pair can briefly exist between pointermove ticks. Round DOWN to the
 * nearest even count so we never read `undefined` from `flat[i+1]` (which
 * would seed `minY = undefined` and produce a `{y: undefined, h: NaN}`
 * rect that propagates through every downstream camera/snap calculation).
 */
export function boundingBoxOfFlatPoints(flat: readonly number[]): Rect {
  // Need at least one (x, y) pair. An odd-length array is rounded down
  // to the nearest even count.
  const n = (flat.length >> 1) * 2;
  if (n < 2) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = flat[0], minY = flat[1], maxX = flat[0], maxY = flat[1];
  for (let i = 0; i < n; i += 2) {
    const x = flat[i];
    const y = flat[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  return { x: minX, y: minY, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Point-in-polygon via ray casting. Polygon is a flat [x0,y0,x1,y1,…]
 * array. Returns true if the point is inside (or on the boundary).
 *
 * Used by lasso selection — at < 3 vertices the polygon is degenerate
 * and the function returns false. Robust to small numerical noise via
 * an open/closed convention (point on edge counts as inside).
 */
export function pointInPolygon(p: Vec2, flat: readonly number[]): boolean {
  const n = flat.length >> 1;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2];
    const yi = flat[i * 2 + 1];
    const xj = flat[j * 2];
    const yj = flat[j * 2 + 1];
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns true if at least one corner of the rect (or its centre) is
 * inside the polygon. We use centre-OR-any-corner as the selection
 * predicate so a rect partly covered by the lasso still counts —
 * matches Miro's "loose" lasso intent vs. strict "fully enclosed".
 */
export function rectOverlapsPolygon(r: Rect, flat: readonly number[]): boolean {
  if (flat.length < 6) return false;
  if (pointInPolygon({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, flat)) return true;
  if (pointInPolygon({ x: r.x,         y: r.y },         flat)) return true;
  if (pointInPolygon({ x: r.x + r.w,   y: r.y },         flat)) return true;
  if (pointInPolygon({ x: r.x,         y: r.y + r.h },   flat)) return true;
  if (pointInPolygon({ x: r.x + r.w,   y: r.y + r.h },   flat)) return true;
  return false;
}
