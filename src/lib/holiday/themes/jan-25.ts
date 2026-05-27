import type { HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  egyptianFlag,
  hoverRepel,
  makeOverlay,
  wavingFlagAnimate,
} from "./_shared";

const PRIMARY = "#ce1126";
const SECONDARY = "#fcd116";
const GLOW = "rgba(206, 17, 38, 0.3)";

const theme: HolidayTheme = {
  id: "jan-25",
  name: "January 25 Revolution",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 32, density: { enable: true } },
      color: { value: ["#ce1126", "#ffffff", "#000000"] },
      opacity: { value: { min: 0.35, max: 0.75 }, animation: { enable: true, speed: 0.8 } },
      size: { value: { min: 2, max: 4 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 1.2 },
        direction: "top",
        outModes: { default: "out" },
      },
      shape: { type: "circle" },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 8 }),
      hoverRepel({ distance: 110, duration: 0.4 })
    ),
  }),
  overlay: makeOverlay(egyptianFlag({ width: 170 }), wavingFlagAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
