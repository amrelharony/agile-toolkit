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
  id: "jul-23",
  name: "July 23 Revolution",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 12, density: { enable: true } },
      // July 23 leans more celebratory — gold gets brighter weight.
      color: { value: ["#ce1126", "#ffffff", "#000000", "#fcd116", "#fde047"] },
      opacity: { value: { min: 0.4, max: 0.9 }, animation: { enable: true, speed: 1.2 } },
      size: { value: { min: 2, max: 5 } },
      move: {
        enable: true,
        speed: { min: 0.5, max: 1.4 },
        direction: "top",
        outModes: { default: "out" },
      },
      shape: { type: ["circle", "star"] },
    },
    interactivity: combineInteractivity(
      // Bigger burst — it's the founding revolution.
      clickBurst({ quantity: 12 }),
      hoverRepel({ distance: 130, duration: 0.4 })
    ),
  }),
  overlay: makeOverlay(
    egyptianFlag({ width: 300, captionAr: "ثورة 23 يوليو", captionEn: "JUL 23 REVOLUTION" }),
    wavingFlagAnimate,
    "top-right"
  ),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
