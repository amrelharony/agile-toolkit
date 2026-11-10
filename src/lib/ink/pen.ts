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
  overshoot = 0.4,
  /** Degrees the oval is turned by (clockwise on screen), for a stamp pressed on askew. */
  tilt = 0
): string {
  const t = (tilt * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const at = (a: number) => {
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return `${r1(cx + x * cos - y * sin)} ${r1(cy + x * sin + y * cos)}`;
  };
  const half = start + Math.PI;
  const end = start + Math.PI * 2 + overshoot;
  const r = `${r1(rx)} ${r1(ry)} ${r1(tilt)}`;
  return `M${at(start)}A${r} 0 1 ${at(half)}A${r} ${overshoot > 0 ? 1 : 0} 1 ${at(end)}`;
}

/** The closed shape of a ring, for its fill. */
export function disc(cx: number, cy: number, rx: number, ry = rx): string {
  return `${ring(cx, cy, rx, ry, 0, 0)}Z`;
}

export function dot(x: number, y: number): string {
  return `M${r1(x)} ${r1(y)}l0.4 0.1`;
}

/**
 * Path data turned by `deg` degrees (clockwise on screen) about (cx, cy): for
 * lettering written square and then set askew. Only for absolute M, L, C, S,
 * Q and T commands, whose numbers all come in x y pairs; an arc or an H or V
 * would be bent out of shape, so they throw.
 */
export function turn(d: string, deg: number, cx: number, cy: number): string {
  if (/[^MLCSQTZ\d.\s,-]/.test(d)) throw new Error(`turn() takes absolute M L C S Q T only: ${d}`);
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return d.replace(/(-?[\d.]+)[\s,]+(-?[\d.]+)/g, (_, xs: string, ys: string) => {
    const x = Number(xs) - cx;
    const y = Number(ys) - cy;
    return `${r1(cx + x * cos - y * sin)} ${r1(cy + x * sin + y * cos)}`;
  });
}
