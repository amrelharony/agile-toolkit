/**
 * Ink graphics: hand-inked spot art drawn in code (DNA-SPEC §9).
 *
 * A drawing is data, not markup: pen strokes (centrelines that draw themselves
 * in), flat watercolour fills, and procedural washes, each naming a theme tone
 * rather than a colour. `components/ink/ink-art.tsx` turns it into an inline SVG
 * whose colours come from the current theme's tokens, so one drawing reads in
 * Comic, Night and High contrast.
 */

/**
 * The theme tokens a drawing may use. Each maps to a CSS custom property in
 * globals.css (`.ink-tone-*` for strokes, `.ink-fill-*` for fills), never to a
 * hex value, so `check:ui` and the theme-contrast tests stay the source of truth.
 */
export const INK_TONES = [
  "ink",
  "sub",
  "paper",
  "accent",
  "accent2",
  "accent3",
  "success",
  "warning",
  "danger",
  "info",
  "moss",
  "wood",
  "plum",
] as const;

export type InkTone = (typeof INK_TONES)[number];

/** The custom property behind each tone, for the few places that colour HTML. */
export const TONE_VAR: Record<InkTone, string> = {
  ink: "var(--text)",
  sub: "var(--sub)",
  paper: "var(--card)",
  accent: "var(--accent)",
  accent2: "var(--accent2)",
  accent3: "var(--accent3)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  moss: "var(--neon-green)",
  wood: "var(--neon-amber)",
  plum: "var(--neon-magenta)",
};

/**
 * One pen stroke along a centreline, in the drawing's viewBox units. A closed
 * stroke may carry a flat watercolour `fill` (a sticky note, a sail), painted
 * just before its own outline, so a shape drawn later covers the ones behind.
 */
export interface InkStroke {
  d: string;
  /** Pen width in viewBox units. Defaults to the drawing's `pen`. */
  w?: number;
  /** Defaults to `ink`. */
  tone?: InkTone;
  /** Flat fill under this stroke. `paper` is opaque and hides what's behind. */
  fill?: InkTone;
  /** The fill's own shape when it isn't the stroke's path. */
  fillD?: string;
}

/**
 * A soft watercolour wash behind the drawing: an irregular blob generated from
 * a seed (lib/ink/wash.ts), so the data stays four numbers instead of a path.
 */
export interface InkWash {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  seed: number;
  tone: InkTone;
}

export interface InkDrawing {
  /** Stable id, also written to `data-ink` for tests and tooling. */
  name: string;
  /** `0 0 96 96` for spot art, `0 0 320 200` for scenes. */
  viewBox: string;
  /** Default pen width in viewBox units. */
  pen?: number;
  /** Bigger scenes bleed their washes through the shared `ink-bleed` filter. */
  bleed?: boolean;
  washes?: InkWash[];
  strokes: InkStroke[];
}

/** Spot art is drawn on a 96-unit square; at 64 px a 2.2 pen is the site's 1.5 px line. */
export const SPOT_VIEWBOX = "0 0 96 96";
export const SPOT_PEN = 2.2;
/** Scenes are drawn on 320 × 200. */
export const SCENE_VIEWBOX = "0 0 320 200";
export const SCENE_PEN = 2.6;
