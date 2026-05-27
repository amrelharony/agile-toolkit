import type { HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  constellationLinks,
  crescentMoonStar,
  hoverAttract,
  makeOverlay,
  pulseGlowAnimate,
} from "./_shared";

const PRIMARY = "#10b981";
const SECONDARY = "#fbbf24";
const GLOW = "rgba(16, 185, 129, 0.3)";

const theme: HolidayTheme = {
  id: "eid-adha",
  name: "Eid al-Adha",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 32, density: { enable: true } },
      color: { value: ["#10b981", "#fbbf24", "#ffffff"] },
      opacity: { value: { min: 0.4, max: 0.9 }, animation: { enable: true, speed: 1 } },
      size: { value: { min: 6, max: 14 } },
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
      // Constellation links between nearby stars — gives the celestial feel.
      links: constellationLinks("#fbbf24", 0.16, 130),
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 6 }),
      hoverAttract({ distance: 200, duration: 0.6 })
    ),
  }),
  overlay: makeOverlay(
    crescentMoonStar({
      moonColor: "#a7f3d0",
      starColor: "#fcd34d",
      glowColor: "rgba(16, 185, 129, 0.45)",
    }),
    pulseGlowAnimate,
    "top-right"
  ),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
