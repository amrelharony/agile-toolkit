import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "mothers-day",
  name: "Mother's Day",
  accent: { primary: "#ff6b9d", secondary: "#c9184a", glow: "rgba(255, 107, 157, 0.25)" },
  cssTokens: accentTokens("#ff6b9d", "#c9184a", "rgba(255, 107, 157, 0.25)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 35, density: { enable: true } },
      color: { value: ["#ff6b9d", "#ffb3c6", "#ff8fab"] },
      opacity: { value: { min: 0.4, max: 0.85 } },
      size: { value: { min: 6, max: 14 } },
      move: {
        enable: true,
        speed: { min: 0.8, max: 1.6 },
        direction: "bottom",
        outModes: { default: "out" },
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["❤", "🌸"], font: "sans-serif", weight: "400" } },
      },
      rotate: { value: { min: -20, max: 20 }, animation: { enable: true, speed: 3 } },
    },
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
