import { r1 } from "./rng";

/**
 * Pen shorthands for drawings: a hand-drawn ring overshoots its own start the
 * way a pen does when it closes a circle, and a dot is a tiny stroke whose
 * round caps make the blob, so it inks in like every other line.
 */
export function ring(
  cx: number,
  cy: number,
  rx: number,
  ry = rx,
  start = -2.3,
  overshoot = 0.4
): string {
  const at = (a: number) => `${r1(cx + Math.cos(a) * rx)} ${r1(cy + Math.sin(a) * ry)}`;
  const half = start + Math.PI;
  const end = start + Math.PI * 2 + overshoot;
  const r = `${r1(rx)} ${r1(ry)}`;
  return `M${at(start)}A${r} 0 0 1 ${at(half)}A${r} 0 ${overshoot > 0 ? 1 : 0} 1 ${at(end)}`;
}

/** The closed shape of a ring, for its fill. */
export function disc(cx: number, cy: number, rx: number, ry = rx): string {
  return `${ring(cx, cy, rx, ry, 0, 0)}Z`;
}

export function dot(x: number, y: number): string {
  return `M${r1(x)} ${r1(y)}l0.4 0.1`;
}
