import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverAttract,
  makeOverlay,
  textOverlay,
} from "./_shared";

const PRIMARY = "#ffd700";
const SECONDARY = "#00e1ff";
const GLOW = "rgba(255, 215, 0, 0.35)";

/** Eid Mubarak entrance: top line scales+fades in, then breathes; bottom line
 *  fades up with a tiny stagger; whole banner gets an underline-glow sweep. */
function eidBannerAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const top = svg.querySelector<SVGTextElement>("[data-holiday-text-1]");
  const bottom = svg.querySelector<SVGTextElement>("[data-holiday-text-2]");
  const tl = ctx.gsap.timeline();
  if (top) {
    ctx.gsap.set(top, { transformOrigin: "50% 50%" });
    tl.from(top, { opacity: 0, scale: 0.7, y: 10, duration: 1, ease: "back.out(1.6)" });
    tl.to(top, { scale: 1.05, duration: 2.6, repeat: -1, yoyo: true, ease: "sine.inOut" }, 1);
  }
  if (bottom) {
    tl.from(bottom, { opacity: 0, y: 12, duration: 0.7, ease: "power2.out" }, 0.5);
  }
  return () => {
    tl.kill();
    if (top) ctx.gsap.killTweensOf(top);
    if (bottom) ctx.gsap.killTweensOf(bottom);
  };
}

const theme: HolidayTheme = {
  id: "eid-fitr",
  name: "Eid al-Fitr",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 50, density: { enable: true } },
      color: { value: ["#ffd700", "#00e1ff", "#ff00aa", "#ffffff", "#fbbf24"] },
      opacity: { value: { min: 0.4, max: 1 }, animation: { enable: true, speed: 2 } },
      size: { value: { min: 1, max: 3 } },
      move: {
        enable: true,
        speed: { min: 2, max: 6 },
        direction: "none",
        outModes: { default: "destroy" },
        // Trails behind each spark — gives the firework look.
        trail: { enable: true, length: 6, fill: { color: "transparent" } },
      },
      shape: { type: ["circle", "star"] },
      life: { duration: { value: 1.8 }, count: 1 },
    },
    emitters: [
      // Big bursts from three corners on a staggered cadence so the screen
      // never has a quiet moment.
      {
        position: { x: 25, y: 35 },
        rate: { delay: 1.4, quantity: 22 },
        direction: "none",
        size: { width: 0, height: 0 },
      },
      {
        position: { x: 75, y: 45 },
        rate: { delay: 1.9, quantity: 24 },
        direction: "none",
        size: { width: 0, height: 0 },
      },
      {
        position: { x: 50, y: 75 },
        rate: { delay: 2.3, quantity: 28 },
        direction: "none",
        size: { width: 0, height: 0 },
      },
    ],
    interactivity: combineInteractivity(
      // Click anywhere = mini firework burst at the cursor.
      clickBurst({ quantity: 14 }),
      hoverAttract({ distance: 120, duration: 0.3 })
    ),
  }),
  overlay: makeOverlay(
    textOverlay({
      primary: PRIMARY,
      glow: GLOW,
      topLine: "Eid Mubarak",
      bottomLine: "EID AL-FITR",
      width: 320,
    }),
    eidBannerAnimate,
    "top-center"
  ),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
