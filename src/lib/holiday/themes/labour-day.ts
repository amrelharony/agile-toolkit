import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "labour-day",
  name: "Labour Day",
  priority: 40,
  accent: { primary: "#dc2626", secondary: "#f87171", glow: "rgba(220, 38, 38, 0.22)" },
  cssTokens: accentTokens("#dc2626", "#f87171", "rgba(220, 38, 38, 0.22)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 25, density: { enable: true } },
      color: { value: ["#dc2626", "#ef4444", "#fca5a5"] },
      opacity: { value: { min: 0.3, max: 0.65 } },
      size: { value: { min: 2, max: 4 } },
      move: { enable: true, speed: 0.5, direction: "none" },
      shape: { type: "circle" },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
