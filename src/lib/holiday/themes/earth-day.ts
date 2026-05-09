import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "earth-day",
  name: "Earth Day",
  priority: 40,
  accent: { primary: "#52b788", secondary: "#2d6a4f", glow: "rgba(82, 183, 136, 0.25)" },
  cssTokens: accentTokens("#52b788", "#2d6a4f", "rgba(82, 183, 136, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 45, density: { enable: true } },
      color: { value: ["#52b788", "#95d5b2", "#40916c", "#74c69d"] },
      opacity: { value: { min: 0.5, max: 0.9 } },
      size: { value: { min: 8, max: 16 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 1.2 },
        direction: "bottom",
        outModes: { default: "out" },
        gravity: { enable: true, acceleration: 2 },
      },
      shape: { type: "character", options: { character: { value: ["🍃", "🌿"], font: "sans-serif" } } },
      rotate: { value: { min: 0, max: 360 }, animation: { enable: true, speed: 4 } },
      wobble: { enable: true, distance: 14, speed: 8 },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
