import type { HolidayTheme } from "../types";
import { accentTokens, baseParticleConfig } from "./_shared";

const theme: HolidayTheme = {
  id: "eid-fitr",
  name: "Eid al-Fitr",
  priority: 100,
  accent: { primary: "#ffd700", secondary: "#00e1ff", glow: "rgba(255, 215, 0, 0.35)" },
  cssTokens: accentTokens("#ffd700", "#00e1ff", "rgba(255, 215, 0, 0.35)"),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 80, density: { enable: true } },
      color: { value: ["#ffd700", "#00e1ff", "#ff00aa", "#ffffff", "#fbbf24"] },
      opacity: { value: { min: 0.4, max: 1 }, animation: { enable: true, speed: 2 } },
      size: { value: { min: 1, max: 3 } },
      move: {
        enable: true,
        speed: { min: 2, max: 6 },
        direction: "none",
        outModes: { default: "destroy" },
      },
      shape: { type: ["circle", "star"] },
      life: { duration: { value: 1.8 }, count: 1 },
    },
    emitters: [
      { position: { x: 30, y: 40 }, rate: { delay: 1.5, quantity: 30 }, direction: "none", size: { width: 0, height: 0 } },
      { position: { x: 70, y: 50 }, rate: { delay: 2, quantity: 35 }, direction: "none", size: { width: 0, height: 0 } },
      { position: { x: 50, y: 70 }, rate: { delay: 2.5, quantity: 40 }, direction: "none", size: { width: 0, height: 0 } },
    ],
  }),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
