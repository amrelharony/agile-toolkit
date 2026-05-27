import type { ISourceOptions } from "@tsparticles/engine";

/**
 * GSAP module surface available to overlay animations. Themes only need
 * `gsap.to`/`gsap.timeline` 99% of the time — typed as the default export of
 * the gsap package so themes can use the full API if needed.
 */
export type HolidayGsap = (typeof import("gsap"))["default"];

export interface HolidayOverlayContext {
  gsap: HolidayGsap;
  /** Whether the user has reduced-motion preference set. Themes should
   *  short-circuit heavy timelines and stick to opacity-only when true. */
  reducedMotion: boolean;
  /** Current weather wind multiplier (0.5–3, normalized around 1).
   *  Themes that use it should be smoothly attenuated. */
  windMultiplier: number;
}

export interface HolidayOverlay {
  /** Inline SVG markup. MUST contain exactly one root <svg> element. */
  svg: string;
  /** Position inside the viewport. Default "top-right". */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "center" | "top-center";
  /** Optional CSS class for fine-grained sizing/offset. Merged on the wrapper. */
  className?: string;
  /**
   * Animation hook called after the SVG mounts. Receives the SVG root and a
   * context with GSAP already loaded. Return a cleanup function so the timeline
   * is killed when the theme unmounts (avoids zombie tweens on dismissal).
   */
  animate?: (svg: SVGSVGElement, ctx: HolidayOverlayContext) => (() => void) | void;
}

export type HolidayId =
  | "new-year"
  | "coptic-christmas"
  | "jan-25"
  | "mothers-day"
  | "earth-day"
  | "sinai-liberation"
  | "labour-day"
  | "jun-30"
  | "jul-23"
  | "halloween"
  | "ramadan"
  | "eid-fitr"
  | "eid-adha"
  | "hijri-new-year"
  | "mawlid"
  | "coptic-easter"
  | "sham-el-nessim";

export interface HolidayWindow {
  /** ISO date (YYYY-MM-DD) in Africa/Cairo when the theme turns on. */
  startISO: string;
  /** ISO date (YYYY-MM-DD) — inclusive, theme lasts until end of this day. */
  endISO: string;
}

export interface HolidayTheme {
  id: HolidayId;
  /** Display name shown in the dismiss chip and settings UI. */
  name: string;
  accent: {
    primary: string;
    secondary: string;
    /** Glow color used in box-shadows and accent halos. */
    glow: string;
  };
  /** CSS custom-property overrides injected into :root while active. */
  cssTokens: Record<string, string>;
  /** Optional tsparticles config — lazy-loaded only when the theme is active. */
  particleConfig?: ISourceOptions;
  /**
   * Optional decorative SVG overlay with an optional GSAP timeline. Rendered
   * above particles, below the dismiss chip. Themes use this for signature
   * pieces (flags, lanterns, fireworks-text, bats) that particles can't express.
   */
  overlay?: HolidayOverlay;
  /** Accessibility behavior — what to do when reduced-motion is preferred. */
  accessibility: {
    reducedMotionFallback: "accent-only" | "none";
  };
}

export interface DetectionResult {
  active: (HolidayTheme & { window: HolidayWindow }) | null;
  suppressed: Array<HolidayTheme & { window: HolidayWindow }>;
}
