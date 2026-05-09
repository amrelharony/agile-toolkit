import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "sham-el-nessim",
  name: "Sham El-Nessim",
  priority: 60,
  accent: { primary: "#84cc16", secondary: "#fef08a", glow: "rgba(132, 204, 22, 0.25)" },
  cssTokens: accentTokens("#84cc16", "#fef08a", "rgba(132, 204, 22, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 30, density: { enable: true } },
      color: { value: ["#84cc16", "#fef08a", "#bef264"] },
      opacity: { value: { min: 0.35, max: 0.8 } },
      size: { value: { min: 10, max: 18 } },
      move: {
        enable: true,
        speed: { min: 0.5, max: 1.4 },
        direction: "bottom",
        outModes: { default: "out" },
        gravity: { enable: true, acceleration: 1.5 },
      },
      shape: { type: "character", options: { character: { value: ["🍃", "🌼"], font: "sans-serif" } } },
      wobble: { enable: true, distance: 10, speed: 4 },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
