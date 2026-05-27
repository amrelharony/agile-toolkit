import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "halloween",
  name: "Halloween",
  accent: { primary: "#f97316", secondary: "#a855f7", glow: "rgba(249, 115, 22, 0.3)" },
  cssTokens: accentTokens("#f97316", "#a855f7", "rgba(249, 115, 22, 0.3)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 30, density: { enable: true } },
      color: { value: ["#f97316", "#a855f7", "#fbbf24"] },
      opacity: { value: { min: 0.4, max: 0.85 } },
      size: { value: { min: 10, max: 16 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 1.2 },
        direction: "none",
        outModes: { default: "out" },
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["🦇", "🎃", "👻"], font: "sans-serif" } },
      },
      rotate: { value: { min: -30, max: 30 }, animation: { enable: true, speed: 3, sync: false } },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
