import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "jan-25",
  name: "January 25 Revolution",
  priority: 80,
  accent: { primary: "#ce1126", secondary: "#fcd116", glow: "rgba(206, 17, 38, 0.3)" },
  cssTokens: accentTokens("#ce1126", "#fcd116", "rgba(206, 17, 38, 0.3)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 30, density: { enable: true } },
      color: { value: ["#ce1126", "#ffffff", "#000000"] },
      opacity: { value: { min: 0.3, max: 0.6 } },
      size: { value: { min: 2, max: 4 } },
      move: { enable: true, speed: 0.4, direction: "top" },
      shape: { type: "circle" },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
