/**
 * Free-hand path rendering using `perfect-freehand`.
 *
 * The pen tool collects pointer samples as a flat [x0,y0,p0,x1,y1,p1,…]
 * array (pressure is optional — falls back to 0.5 if the device doesn't
 * supply it). On commit we hand the samples to `getStroke()` which
 * returns a list of outline points; we convert those to an SVG path.
 */

import { getStroke } from "perfect-freehand";

export interface FreehandOptions {
  size?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  /** When true, ends taper to a sharp point. */
  simulatePressure?: boolean;
}

const DEFAULTS: Required<FreehandOptions> = {
  size: 6,
  thinning: 0.5,
  smoothing: 0.6,
  streamline: 0.5,
  simulatePressure: true,
};

/**
 * Convert a flat array of point coords (and optional pressure triples) to
 * an SVG path string suitable for `<path d="...">`.
 *
 * Two input shapes accepted:
 * - `[x0, y0, x1, y1, …]` — no pressure (pressure = 0.5)
 * - `[x0, y0, p0, x1, y1, p1, …]` — explicit pressure (`pressure` flag = true)
 */
export function flatPointsToPath(
  flat: readonly number[],
  opts: FreehandOptions = {},
  withPressure = false
): string {
  // Single tap (one sample) — render a dot rather than nothing. A single
  // click on the pen tool is a valid user gesture and "nothing happens"
  // is unexpected. perfect-freehand's `last` flag draws a tapered dot
  // for a one-point stroke when we provide a single sample.
  const minLen = withPressure ? 3 : 2;
  if (flat.length < minLen) return "";
  const stride = withPressure ? 3 : 2;
  const points: number[][] = [];
  for (let i = 0; i + stride - 1 < flat.length; i += stride) {
    if (withPressure) {
      points.push([flat[i], flat[i + 1], flat[i + 2]]);
    } else {
      points.push([flat[i], flat[i + 1], 0.5]);
    }
  }
  if (points.length === 0) return "";
  if (points.length === 1) {
    // Render a small filled circle at the sample. perfect-freehand needs
    // ≥ 2 points to produce a meaningful outline; we fake a dot with two
    // co-located samples and ask the stroke to "complete" so it tapers
    // to a circular blob.
    const [x, y] = points[0];
    const o = { ...DEFAULTS, ...opts };
    const r = o.size / 2;
    // SVG path for a circle via two arc segments.
    return `M ${(x - r).toFixed(2)} ${y.toFixed(2)} a ${r} ${r} 0 1 0 ${(r * 2).toFixed(2)} 0 a ${r} ${r} 0 1 0 ${(-r * 2).toFixed(2)} 0 Z`;
  }
  const o = { ...DEFAULTS, ...opts };
  const outline = getStroke(points, o);
  if (outline.length < 2) return "";
  return svgPathFromStroke(outline);
}

/**
 * Translate a flat [x0,y0,x1,y1,…] freehand points array by (dx, dy).
 *
 * Freehand `points` are stored in WORLD coordinates (the renderer and
 * SVG export both treat them as absolute), so every code path that
 * moves a freehand object's x/y MUST translate the points by the same
 * delta — otherwise the bbox moves while the visible ink stays put.
 * Used by the drag loop, arrow-key nudge, align/distribute, and
 * clipboard paste/duplicate.
 *
 * Defensive against odd-length input (orphan trailing x): the trailing
 * coord is copied verbatim rather than read past the end.
 */
export function translateFlatPoints(flat: readonly number[], dx: number, dy: number): number[] {
  const out = new Array<number>(flat.length);
  const n = (flat.length >> 1) * 2;
  for (let i = 0; i < n; i += 2) {
    out[i] = flat[i] + dx;
    out[i + 1] = flat[i + 1] + dy;
  }
  if (flat.length > n) out[n] = flat[n];
  return out;
}

/** Average two points (perfect-freehand quadratic-curve trick). */
function avg(a: number[], b: number[]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Convert perfect-freehand outline points into a closed SVG path using
 * quadratic curves between successive midpoints. This is the recommended
 * approach from the library docs — it produces a smooth ink-like contour
 * without explicit Bezier control point math.
 */
function svgPathFromStroke(stroke: number[][]): string {
  if (stroke.length < 2) return "";
  const first = stroke[0];
  const second = stroke[1];
  const startMid = avg(first, second);
  let d = `M ${startMid[0].toFixed(2)} ${startMid[1].toFixed(2)} Q`;
  for (let i = 1; i < stroke.length - 1; i++) {
    const cur = stroke[i];
    const next = stroke[i + 1];
    const mid = avg(cur, next);
    d += ` ${cur[0].toFixed(2)} ${cur[1].toFixed(2)} ${mid[0].toFixed(2)} ${mid[1].toFixed(2)}`;
  }
  d += " Z";
  return d;
}
