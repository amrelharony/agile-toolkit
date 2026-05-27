import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "mawlid",
  name: "Mawlid al-Nabi",
  accent: { primary: "#10b981", secondary: "#fbbf24", glow: "rgba(251, 191, 36, 0.25)" },
  cssTokens: accentTokens("#10b981", "#fbbf24", "rgba(251, 191, 36, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 35, density: { enable: true } },
      color: { value: ["#fbbf24", "#10b981", "#ffffff"] },
      opacity: { value: { min: 0.4, max: 0.9 }, animation: { enable: true, speed: 0.8 } },
      size: { value: { min: 2, max: 5 } },
      move: { enable: true, speed: 0.6, direction: "none" },
      shape: { type: "star" },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
