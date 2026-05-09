import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "coptic-easter",
  name: "Coptic Easter",
  priority: 60,
  accent: { primary: "#f472b6", secondary: "#fde68a", glow: "rgba(244, 114, 182, 0.25)" },
  cssTokens: accentTokens("#f472b6", "#fde68a", "rgba(244, 114, 182, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 30, density: { enable: true } },
      color: { value: ["#f472b6", "#fde68a", "#c084fc", "#fbcfe8"] },
      opacity: { value: { min: 0.4, max: 0.85 } },
      size: { value: { min: 10, max: 18 } },
      move: {
        enable: true,
        speed: { min: 0.6, max: 1.5 },
        direction: "bottom",
        outModes: { default: "out" },
        gravity: { enable: true, acceleration: 2 },
      },
      shape: { type: "character", options: { character: { value: ["🌸", "🌷"], font: "sans-serif" } } },
      wobble: { enable: true, distance: 12, speed: 5 },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
