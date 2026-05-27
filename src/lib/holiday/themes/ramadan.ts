import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "ramadan",
  name: "Ramadan",
  accent: { primary: "#f59e0b", secondary: "#7c3aed", glow: "rgba(245, 158, 11, 0.25)" },
  cssTokens: accentTokens("#f59e0b", "#7c3aed", "rgba(245, 158, 11, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 20, density: { enable: true } },
      color: { value: ["#f59e0b", "#fcd34d", "#fbbf24"] },
      opacity: {
        value: { min: 0.4, max: 0.9 },
        animation: { enable: true, speed: 0.6, sync: false },
      },
      size: { value: { min: 12, max: 22 } },
      move: {
        enable: true,
        speed: { min: 0.2, max: 0.8 },
        direction: "top",
        outModes: { default: "out" },
        straight: false,
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["🏮", "🌙"], font: "sans-serif" } },
      },
      wobble: { enable: true, distance: 6, speed: 2 },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
