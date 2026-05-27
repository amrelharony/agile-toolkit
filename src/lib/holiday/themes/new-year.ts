import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverAttract,
  makeOverlay,
} from "./_shared";
import { todayInCairo } from "../calendars/gregorian";

const PRIMARY = "#ffd700";
const SECONDARY = "#ff00aa";
const GLOW = "rgba(255, 215, 0, 0.35)";

/** Year number: scales-in with a bounce, then a gentle breathing pulse;
 *  underline sweeps in. The year text is replaced at runtime with the actual
 *  Cairo-anchored year so it stays current. */
function yearAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const year = svg.querySelector<SVGTextElement>("[data-ny-year]");
  const sub = svg.querySelector<SVGTextElement>("[data-ny-sub]");
  const underline = svg.querySelector<SVGRectElement>("[data-ny-underline]");
  // Stamp the actual current year (Cairo-anchored) into the text node so the
  // overlay stays correct even after a long-running tab outlives Dec 31.
  if (year) {
    try {
      const { y } = todayInCairo(new Date());
      year.textContent = String(y);
    } catch {
      /* keep build-time fallback */
    }
  }

  const tl = ctx.gsap.timeline();
  if (year) {
    ctx.gsap.set(year, { transformOrigin: "50% 50%" });
    tl.from(year, { opacity: 0, scale: 0.4, duration: 1.1, ease: "back.out(1.8)" });
    tl.to(year, { scale: 1.06, duration: 2.6, repeat: -1, yoyo: true, ease: "sine.inOut" }, 1.1);
  }
  if (sub) {
    tl.from(sub, { opacity: 0, y: 8, duration: 0.7, ease: "power2.out" }, 0.4);
  }
  if (underline) {
    ctx.gsap.set(underline, { transformOrigin: "50% 50%" });
    tl.from(underline, { scaleX: 0, duration: 0.9, ease: "power3.out" }, 0.5);
  }
  return () => {
    tl.kill();
    if (year) ctx.gsap.killTweensOf(year);
    if (sub) ctx.gsap.killTweensOf(sub);
    if (underline) ctx.gsap.killTweensOf(underline);
  };
}

const yearSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="420" height="158" data-holiday-svg="new-year-banner" style="overflow:visible;filter:drop-shadow(0 0 28px rgba(255,215,0,0.6));">
  <text data-ny-year x="50%" y="62%" text-anchor="middle" font-family="'Source Serif 4', Georgia, serif" font-size="60" font-weight="700" fill="#ffd700" letter-spacing="2">2026</text>
  <rect data-ny-underline x="120" y="80" width="80" height="2" fill="#ff00aa" rx="1"/>
  <text data-ny-sub x="50%" y="92%" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" font-weight="500" fill="#ffd700" opacity="0.75" letter-spacing="8">HAPPY NEW YEAR</text>
</svg>`;

const theme: HolidayTheme = {
  id: "new-year",
  name: "New Year",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 18, density: { enable: true } },
      color: { value: ["#ffd700", "#ff00aa", "#00e1ff", "#ffffff"] },
      opacity: { value: { min: 0.5, max: 1 }, animation: { enable: true, speed: 2, sync: false } },
      size: { value: { min: 1.5, max: 4 } },
      move: {
        enable: true,
        speed: { min: 1, max: 4 },
        direction: "top",
        outModes: { default: "destroy" },
      },
      shape: { type: ["circle", "star"] },
      // Per-particle confetti streak — see eid-fitr for why this beats move.trail.
      effect: { type: "trail", options: { trail: { length: 6, fade: true } } },
      life: { duration: { value: 3 }, count: 1 },
      rotate: { value: { min: 0, max: 360 }, animation: { enable: true, speed: 5 } },
    },
    // Single corner emitter — two felt noisy and the year-banner is doing
    // the centerpiece work.
    emitters: {
      position: { x: 50, y: 100 },
      rate: { delay: 0.8, quantity: 4 },
      size: { width: 40, height: 0, mode: "percent" },
      direction: "top",
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 14 }),
      hoverAttract({ distance: 140, duration: 0.4 })
    ),
  }),
  overlay: makeOverlay(yearSvg, yearAnimate, "top-center"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
