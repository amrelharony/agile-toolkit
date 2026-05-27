import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "eid-adha",
  name: "Eid al-Adha",
  accent: { primary: "#10b981", secondary: "#fbbf24", glow: "rgba(16, 185, 129, 0.3)" },
  cssTokens: accentTokens("#10b981", "#fbbf24", "rgba(16, 185, 129, 0.3)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 25, density: { enable: true } },
      color: { value: ["#10b981", "#fbbf24", "#ffffff"] },
      opacity: { value: { min: 0.4, max: 0.9 }, animation: { enable: true, speed: 1 } },
      size: { value: { min: 8, max: 16 } },
      move: {
        enable: true,
        speed: { min: 0.2, max: 0.6 },
        direction: "top",
        outModes: { default: "out" },
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["🌙", "⭐"], font: "sans-serif" } },
      },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
