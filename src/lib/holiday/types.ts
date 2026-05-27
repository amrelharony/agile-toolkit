import type { ISourceOptions } from "@tsparticles/engine";

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
  /** Optional inline SVG overlay rendered at a corner of the viewport. */
  svgOverlay?: string;
  /** Accessibility behavior — what to do when reduced-motion is preferred. */
  accessibility: {
    reducedMotionFallback: "accent-only" | "none";
  };
}

export interface DetectionResult {
  active: (HolidayTheme & { window: HolidayWindow }) | null;
  suppressed: Array<HolidayTheme & { window: HolidayWindow }>;
}
