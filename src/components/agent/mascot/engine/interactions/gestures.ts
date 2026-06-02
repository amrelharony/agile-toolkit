/**
 * Gesture recognition — ported from the vanilla mascot (3501-3561). Pointer
 * points captured near the mascot are analysed for a circle (→ spin) or a
 * zigzag (→ wiggle). `analyzeGesture` is the pure detector (unit-tested); the
 * tracker wraps it with the source's debounce + cooldown + proximity gate.
 */

export interface GesturePoint {
  x: number;
  y: number;
}

const MIN_POINTS = 12;
const CIRCLE_ANGLE = 5; // radians of accumulated turn
const ZIGZAG_REVERSALS = 4;

/** Detect a circle or zigzag from captured points. Pure (source detectGesture). */
export function analyzeGesture(points: GesturePoint[]): "circle" | "zigzag" | null {
  if (points.length < MIN_POINTS) return null;

  // Circle: accumulate signed angle around the centroid.
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / points.length;
  const cy = sy / points.length;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a1 = Math.atan2(points[i - 1].y - cy, points[i - 1].x - cx);
    const a2 = Math.atan2(points[i].y - cy, points[i].x - cx);
    let da = a2 - a1;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    total += da;
  }
  if (Math.abs(total) > CIRCLE_ANGLE) return "circle";

  // Zigzag: count horizontal direction reversals.
  let reversals = 0;
  let lastDir = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dir = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    if (dir !== 0 && dir !== lastDir && lastDir !== 0) reversals++;
    if (dir !== 0) lastDir = dir;
  }
  if (reversals >= ZIGZAG_REVERSALS) return "zigzag";

  return null;
}

export interface GestureTracker {
  /** Feed a pointer sample (page coords) + the mascot screen centre + elapsed time. */
  track(x: number, y: number, cx: number, cy: number, now: number): void;
  dispose(): void;
}

const MAX_POINTS = 60;
const COOLDOWN = 3; // seconds between gestures
const NEAR = 120; // px proximity to the mascot centre

export function createGestureTracker(onGesture: (g: "circle" | "zigzag") => void): GestureTracker {
  const points: GesturePoint[] = [];
  let lastTime = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function detect(now: number): void {
    if (now - lastTime < COOLDOWN) {
      points.length = 0;
      return;
    }
    const g = analyzeGesture(points);
    if (g) {
      onGesture(g);
      lastTime = now;
    }
    points.length = 0;
  }

  function track(x: number, y: number, cx: number, cy: number, now: number): void {
    if (Math.hypot(x - cx, y - cy) > NEAR) return;
    points.push({ x, y });
    if (points.length > MAX_POINTS) points.shift();
    clearTimeout(timer);
    timer = setTimeout(() => detect(now), 200);
  }

  function dispose(): void {
    clearTimeout(timer);
  }

  return { track, dispose };
}
