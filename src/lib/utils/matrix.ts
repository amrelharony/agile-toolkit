/**
 * The maths of a draggable 2×2 (components/shared/drag-matrix): where a
 * value sits on an axis, which value a pointer is over, a keyboard step,
 * and how dots on the same spot fan out. Pure.
 *
 * An axis is either linear (min to max in steps, e.g. the Stakeholder Map's
 * 0–10 or Value/Effort's effort 1–10) or ordinal (a list of values drawn
 * evenly spaced, e.g. the Fibonacci value axis 1, 2, 3, 5, 8, 13, 20). An
 * off-step value an item already holds is drawn where it falls between
 * its neighbours and is never changed until the item is moved.
 */

export type MatrixAxis =
  | {
      kind: "linear";
      min: number;
      max: number;
      step: number;
      /** Where a keyboard move of an unplaced axis starts (default: the middle, on a step). */
      start?: number;
    }
  | {
      kind: "ordinal";
      /** The values, ascending, drawn evenly spaced. */
      steps: readonly number[];
      start?: number;
    };

export interface MatrixAt {
  x: number;
  y: number;
}

/** The axis's lowest value. */
export const axisMin = (a: MatrixAxis): number => (a.kind === "linear" ? a.min : a.steps[0]);
/** The axis's highest value. */
export const axisMax = (a: MatrixAxis): number =>
  a.kind === "linear" ? a.max : a.steps[a.steps.length - 1];

/** The nearest value on the axis to `n` (kept within it). */
export function snap(a: MatrixAxis, n: number): number {
  if (a.kind === "linear") {
    const k = Math.round((n - a.min) / a.step);
    const v = a.min + k * a.step;
    // Round away float noise from the step (0.1 + 0.2).
    const clean = Math.round(v * 1e9) / 1e9;
    return Math.min(a.max, Math.max(a.min, clean));
  }
  let best = a.steps[0];
  for (const s of a.steps) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}

/** Where `v` sits along the axis, 0 (min) to 1 (max); an ordinal off-step value between its neighbours. */
export function axisFraction(a: MatrixAxis, v: number): number {
  if (a.kind === "linear") {
    const span = a.max - a.min;
    return span <= 0 ? 0 : Math.min(1, Math.max(0, (v - a.min) / span));
  }
  const s = a.steps;
  if (s.length < 2) return 0;
  if (v <= s[0]) return 0;
  if (v >= s[s.length - 1]) return 1;
  for (let i = 0; i < s.length - 1; i++) {
    if (v >= s[i] && v <= s[i + 1]) {
      const part = s[i + 1] === s[i] ? 0 : (v - s[i]) / (s[i + 1] - s[i]);
      return (i + part) / (s.length - 1);
    }
  }
  return 0;
}

/** The axis value at a fraction 0–1 along it, snapped to a step. */
export function valueAtFraction(a: MatrixAxis, f: number): number {
  const t = Math.min(1, Math.max(0, f));
  if (a.kind === "linear") return snap(a, a.min + t * (a.max - a.min));
  return a.steps[Math.round(t * (a.steps.length - 1))];
}

/** Where a value is drawn, as a percentage 0–100, kept 4–96 so a dot never leaves the map. */
export function percentAlong(a: MatrixAxis, v: number): number {
  return Math.min(96, Math.max(4, axisFraction(a, v) * 100));
}

/**
 * The value pair a pointer is over (x left to right, y bottom to top),
 * snapped to the axes; null outside the map or before it has a size.
 */
export function atFromPointer(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  x: MatrixAxis,
  y: MatrixAxis
): MatrixAt | null {
  if (rect.width === 0 || rect.height === 0) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { x: valueAtFraction(x, fx), y: valueAtFraction(y, 1 - fy) };
}

/** Where a keyboard move of an unplaced axis starts. */
export function axisStart(a: MatrixAxis): number {
  if (a.start !== undefined) return a.start;
  if (a.kind === "linear") return snap(a, (a.min + a.max) / 2);
  return a.steps[Math.floor((a.steps.length - 1) / 2)];
}

/**
 * One keyboard move of `delta` steps from `from` (null: not placed, starts
 * at the axis's start), kept on the axis. On an ordinal axis an off-step
 * value moves to the next step in that direction.
 */
export function nudge(a: MatrixAxis, from: number | null, delta: number): number {
  const base = from ?? axisStart(a);
  if (a.kind === "linear") return snap(a, base + delta * a.step);
  const s = a.steps;
  let i = s.indexOf(base);
  if (i === -1) {
    // Off-step: the step just below (moving up) or just above (moving down) it.
    if (delta > 0) i = s.reduce((acc, v, k) => (v < base ? k : acc), -1);
    else {
      const above = s.findIndex((v) => v > base);
      i = above === -1 ? s.length : above;
    }
  }
  return s[Math.min(s.length - 1, Math.max(0, i + delta))];
}

/** How a dot is offset from its spot when others share it. */
export interface FanOut {
  dx: number;
  dy: number;
  /** Dots on this spot. */
  count: number;
  /** The first on its spot (it carries the count badge). */
  first: boolean;
}

/**
 * Dots on the same spot fan out a little, in order: the first stays put,
 * the rest step across three columns and down in rows, in pixels.
 */
export function fanOut<T extends { id: string; x: number; y: number }>(
  pts: readonly T[]
): Map<string, FanOut> {
  const atSpot = new Map<string, number>();
  const index = pts.map((p) => {
    const key = `${p.x}:${p.y}`;
    const i = atSpot.get(key) ?? 0;
    atSpot.set(key, i + 1);
    return { id: p.id, key, i };
  });
  const out = new Map<string, FanOut>();
  for (const { id, key, i } of index) {
    out.set(id, {
      dx: i === 0 ? 0 : ((i % 3) - 1) * 10,
      dy: i === 0 ? 0 : (Math.floor(i / 3) + 1) * 8,
      count: atSpot.get(key) ?? 1,
      first: i === 0,
    });
  }
  return out;
}
