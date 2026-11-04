/**
 * The air around Amr while a weather or fireworks scene plays: rain round his
 * umbrella, snow, wind, fog, dust, stars or sparks. The art carries the moment;
 * this only sets the air around him (mascot-fx.tsx draws it, behind him, so it
 * never covers his face, and only while the scene is on screen).
 *
 * Pure data, so the sprite and the tests share it.
 */

export type SceneFx =
  | "rain"
  | "downpour"
  | "storm"
  | "snow"
  | "wind"
  | "fog"
  | "dust"
  | "stars"
  | "sparks";

/** By the scene's sheet (the first part of its name). */
const BY_SHEET: Readonly<Record<string, SceneFx>> = {
  rain: "rain",
  downpour: "downpour",
  storm: "storm",
  snow: "snow",
  wind: "wind",
  grey: "fog",
  dust: "dust",
  stars: "stars",
  fireworks: "sparks",
};

/** The air reaches this far past his box on each side, and this far above it. */
export const FX_SPREAD = { x: 0.35, top: 0.25 } as const;
/** A burst of sparks: eight rays, and its colours by burst. */
export const SPARK_RAYS: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];
export const SPARK_COLOURS: readonly string[] = ["#f5c542", "#ff7aa8", "#5fd4f4"];

/** The sheets that have an effect. */
export const FX_SHEETS: readonly string[] = Object.keys(BY_SHEET);

/** The effect for a clip, by its scene's sheet: `scene:rain.feel` → rain. */
export function sceneFx(clipName: string): SceneFx | null {
  if (!clipName.startsWith("scene:")) return null;
  const sheet = clipName.slice("scene:".length).split(".")[0];
  return BY_SHEET[sheet] ?? null;
}

export interface Particle {
  /** Across the air, 0–100 (%). */
  x: number;
  /** Down it, 0–1; each effect keeps to its own band. */
  y: number;
  /** Seconds, negative: already on its way when the scene starts. */
  delay: number;
  /** Seconds per pass. */
  dur: number;
  /** A size factor around 1. */
  size: number;
}

/** How many of each, how long one pass takes (s), and how much sizes vary. */
const SPEC: Readonly<
  Record<SceneFx, { n: number; dur: readonly [number, number]; size: readonly [number, number] }>
> = {
  rain: { n: 14, dur: [0.6, 0.9], size: [0.8, 1.2] },
  downpour: { n: 24, dur: [0.4, 0.6], size: [1, 1.4] },
  storm: { n: 24, dur: [0.35, 0.55], size: [1, 1.4] },
  snow: { n: 18, dur: [3, 5], size: [0.7, 1.3] },
  wind: { n: 6, dur: [0.9, 1.4], size: [0.7, 1.3] },
  fog: { n: 3, dur: [6, 9], size: [0.8, 1.2] },
  dust: { n: 12, dur: [1.6, 2.6], size: [0.6, 1.2] },
  stars: { n: 8, dur: [1.4, 2.4], size: [0.7, 1.2] },
  sparks: { n: 3, dur: [1.3, 1.7], size: [0.8, 1.2] },
};

/** A fixed scatter in [0, 1): the same every render, so nothing reshuffles. */
function scatter(i: number, k: number): number {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const between = ([lo, hi]: readonly [number, number], t: number) => lo + (hi - lo) * t;

/** Where each particle of an effect starts, and how it moves. */
export function particles(kind: SceneFx): Particle[] {
  const { n, dur, size } = SPEC[kind];
  return Array.from({ length: n }, (_, i) => {
    const d = between(dur, scatter(i, 4));
    return {
      // Spread evenly across, each nudged a little, so there are no gaps or clumps.
      x: ((i + 0.2 + 0.6 * scatter(i, 1)) / n) * 100,
      y: scatter(i, 2),
      delay: -scatter(i, 3) * d,
      dur: d,
      size: between(size, scatter(i, 5)),
    };
  });
}
