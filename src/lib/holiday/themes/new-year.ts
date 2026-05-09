import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "new-year",
  name: "New Year",
  priority: 45,
  accent: { primary: "#ffd700", secondary: "#ff00aa", glow: "rgba(255, 215, 0, 0.3)" },
  cssTokens: accentTokens("#ffd700", "#ff00aa", "rgba(255, 215, 0, 0.3)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 60, density: { enable: true } },
      color: { value: ["#ffd700", "#ff00aa", "#00e1ff", "#ffffff"] },
      opacity: { value: { min: 0.5, max: 1 }, animation: { enable: true, speed: 2, sync: false } },
      size: { value: { min: 1, max: 3 } },
      move: { enable: true, speed: { min: 1, max: 4 }, direction: "top", outModes: { default: "destroy" } },
      shape: { type: ["circle", "star"] },
      life: { duration: { value: 3 }, count: 1 },
    },
    emitters: [
      {
        position: { x: 20, y: 100 },
        rate: { delay: 0.4, quantity: 12 },
        size: { width: 0, height: 0 },
        direction: "top",
      },
      {
        position: { x: 80, y: 100 },
        rate: { delay: 0.5, quantity: 12 },
        size: { width: 0, height: 0 },
        direction: "top",
      },
    ],
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
