/**
 * The wheel's geometry: slices sized by weight, the turn that lands the
 * pointer on the winner, and the SVG paths. The host's page and every phone
 * in a live room work the landing out from the same numbers (the names, their
 * weights, the winner, the number of turns and where in the slice it stops),
 * so they all stop on the same name.
 *
 * Angles are degrees, clockwise from the top, where the pointer sits. The
 * wheel turns clockwise: a point at angle a ends up at a + rotation. Pure.
 */

import { randomInt, type Rng } from "@/lib/utils/random";

/** How long a spin takes. Under reduced motion the wheel lands at once. */
export const SPIN_MS = 2500;

/** Whole turns before the wheel settles. */
export const SPIN_TURNS = { min: 4, max: 7 } as const;

/** Where in the winner's slice the pointer stops, kept clear of its edges. */
export const LAND_OFFSET = { min: 0.2, max: 0.8 } as const;

export interface Slice {
  start: number;
  end: number;
  mid: number;
}

/** A weight as the wheel uses it: 1 to 5, whole; anything else counts as 1. */
const weightOf = (w: unknown) =>
  typeof w === "number" && Number.isFinite(w) ? Math.min(5, Math.max(1, Math.round(w))) : 1;

/** One slice per weight, in order, sized by weight, together a full turn. */
export function wheelSlices(weights: readonly number[]): Slice[] {
  const ws = weights.map(weightOf);
  const total = ws.reduce((n, w) => n + w, 0);
  if (total <= 0) return [];
  let at = 0;
  return ws.map((w, i) => {
    const start = at;
    const end = i === ws.length - 1 ? 360 : at + (w / total) * 360;
    at = end;
    return { start, end, mid: (start + end) / 2 };
  });
}

const mod360 = (a: number) => ((a % 360) + 360) % 360;

/**
 * The rotation that leaves the pointer `offset` of the way into slice
 * `winner`, after at least `turns` whole turns from `from` (the wheel's
 * rotation now). Always more than `from`, so the wheel keeps turning forward.
 */
export function landingRotation(
  slices: readonly Slice[],
  winner: number,
  turns: number,
  offset: number,
  from = 0
): number {
  const slice = slices[winner];
  if (!slice) return from;
  const o = Math.min(LAND_OFFSET.max, Math.max(LAND_OFFSET.min, offset));
  const at = slice.start + o * (slice.end - slice.start);
  // The pointer is at 0: the winner's point must turn to 0 (mod 360).
  const target = mod360(360 - at);
  const base = from + Math.max(1, Math.round(turns)) * 360;
  return base + mod360(target - mod360(base));
}

/** The slice under the pointer when the wheel is turned by `rotation`. */
export function sliceAtPointer(slices: readonly Slice[], rotation: number): number {
  const at = mod360(-rotation);
  const i = slices.findIndex((s) => at >= s.start && at < s.end);
  return i === -1 ? slices.length - 1 : i;
}

/** How a spin moves: whole turns and where in the slice it stops. */
export function spinMotion(rng?: Rng): { turns: number; offset: number } {
  const turns = randomInt(SPIN_TURNS.min, SPIN_TURNS.max, rng);
  const r = rng ? rng() : Math.random();
  return { turns, offset: LAND_OFFSET.min + r * (LAND_OFFSET.max - LAND_OFFSET.min) };
}

/** A point on a circle at `angle` degrees clockwise from the top. */
export function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An SVG path for one slice; a single slice is the whole disc. */
export function slicePath(cx: number, cy: number, r: number, slice: Slice): string {
  const span = slice.end - slice.start;
  if (span >= 359.999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
  }
  const [x1, y1] = polar(cx, cy, r, slice.start);
  const [x2, y2] = polar(cx, cy, r, slice.end);
  const large = span > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${round2(x1)} ${round2(y1)} A ${r} ${r} 0 ${large} 1 ${round2(x2)} ${round2(y2)} Z`;
}

/** A name short enough for its slice: cut with an ellipsis past `max` characters. */
export function sliceLabel(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, Math.max(1, max - 1)).trimEnd()}…` : name;
}

/** Characters a slice's label can hold, by how many names share the wheel. */
export function labelChars(count: number): number {
  if (count <= 6) return 14;
  if (count <= 12) return 12;
  if (count <= 20) return 10;
  return 8;
}
