import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "hijri-new-year",
  name: "Hijri New Year",
  priority: 90,
  accent: { primary: "#3b82f6", secondary: "#cbd5e1", glow: "rgba(59, 130, 246, 0.25)" },
  cssTokens: accentTokens("#3b82f6", "#cbd5e1", "rgba(59, 130, 246, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 60, density: { enable: true } },
      color: { value: ["#cbd5e1", "#ffffff", "#93c5fd"] },
      opacity: { value: { min: 0.3, max: 0.9 }, animation: { enable: true, speed: 1.5 } },
      size: { value: { min: 1, max: 2.5 } },
      move: { enable: true, speed: 0.3, direction: "none" },
      shape: { type: "circle" },
      twinkle: { particles: { enable: true, frequency: 0.1, opacity: 1 } },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
