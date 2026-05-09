import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "coptic-christmas",
  name: "Coptic Christmas",
  priority: 60,
  accent: { primary: "#e63946", secondary: "#2a9d8f", glow: "rgba(230, 57, 70, 0.25)" },
  cssTokens: accentTokens("#e63946", "#2a9d8f", "rgba(230, 57, 70, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 80, density: { enable: true } },
      color: { value: "#ffffff" },
      opacity: { value: { min: 0.4, max: 0.9 } },
      size: { value: { min: 2, max: 5 } },
      move: { enable: true, speed: { min: 0.6, max: 1.6 }, direction: "bottom", outModes: { default: "out" } },
      shape: { type: "circle" },
      wobble: { enable: true, distance: 8, speed: 4 },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
