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
  id: "sinai-liberation",
  name: "Sinai Liberation Day",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 32, density: { enable: true } },
      color: { value: ["#ce1126", "#ffffff", "#000000"] },
      opacity: { value: { min: 0.3, max: 0.7 } },
      size: { value: { min: 2, max: 5 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 1.0 },
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
