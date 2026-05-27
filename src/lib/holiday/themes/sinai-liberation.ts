import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "sinai-liberation",
  name: "Sinai Liberation Day",
  accent: { primary: "#ce1126", secondary: "#fcd116", glow: "rgba(206, 17, 38, 0.3)" },
  cssTokens: accentTokens("#ce1126", "#fcd116", "rgba(206, 17, 38, 0.3)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 30, density: { enable: true } },
      color: { value: ["#ce1126", "#ffffff", "#000000"] },
      opacity: { value: { min: 0.3, max: 0.7 } },
      size: { value: { min: 2, max: 5 } },
      move: { enable: true, speed: 0.6, direction: "top" },
      shape: { type: "circle" },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
