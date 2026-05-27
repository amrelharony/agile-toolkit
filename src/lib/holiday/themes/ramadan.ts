import type { HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  crescentMoonStar,
  hoverAttract,
  makeOverlay,
  polygonPath,
  pulseGlowAnimate,
} from "./_shared";

const PRIMARY = "#f59e0b";
const SECONDARY = "#7c3aed";
const GLOW = "rgba(245, 158, 11, 0.25)";

const theme: HolidayTheme = {
  id: "ramadan",
  name: "Ramadan",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 22, density: { enable: true } },
      color: { value: ["#f59e0b", "#fcd34d", "#fbbf24"] },
      opacity: {
        value: { min: 0.45, max: 0.95 },
        animation: { enable: true, speed: 0.7, sync: false },
      },
      size: { value: { min: 12, max: 22 } },
      move: {
        enable: true,
        speed: { min: 0.25, max: 0.85 },
        direction: "top",
        outModes: { default: "out" },
        straight: false,
        // Soft sway as lanterns rise — wandering reduces the conveyor-belt feel.
        // generator field is REQUIRED for path-polygon to activate (without it,
        // the engine never picks the polygon path-generator and particles drift
        // in straight lines).
        path: polygonPath({ sides: 6, turnSteps: 30, angle: 30, delay: 0.1 }),
      },
      // Circles for lanterns, stars for the moon — emoji glyphs are flat
      // colored shapes on Windows sans-serif. The SVG crescent overlay
      // carries the moon-and-star theming.
      shape: { type: ["circle", "star"] },
      wobble: { enable: true, distance: 6, speed: 2 },
      // Ember sparks emitted from lanterns — small bright trail-like specks.
      shadow: { enable: true, color: "#f59e0b", blur: 12 },
    },
    emitters: {
      // Steady stream of small amber sparks rising from the bottom edge —
      // gives the screen a "fire-lit" warmth without being busy.
      position: { x: 50, y: 100 },
      rate: { delay: 0.6, quantity: 1 },
      size: { width: 100, height: 0, mode: "percent" },
      direction: "top",
      particles: {
        number: { value: 0 },
        color: { value: ["#fcd34d", "#fbbf24"] },
        opacity: {
          value: { min: 0.2, max: 0.6 },
          animation: { enable: true, speed: 1.5, startValue: "max", destroy: "min" },
        },
        size: { value: { min: 1, max: 2 } },
        move: {
          enable: true,
          speed: { min: 1.2, max: 2.4 },
          direction: "top",
          outModes: { default: "destroy" },
          straight: false,
        },
        life: { duration: { value: 4 }, count: 1 },
        shape: { type: "circle" },
      },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 4 }),
      hoverAttract({ distance: 180, duration: 0.5 })
    ),
  }),
  overlay: makeOverlay(
    crescentMoonStar({
      moonColor: "#fcd34d",
      starColor: "#fef3c7",
      glowColor: "rgba(245, 158, 11, 0.5)",
    }),
    pulseGlowAnimate,
    "top-right"
  ),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
