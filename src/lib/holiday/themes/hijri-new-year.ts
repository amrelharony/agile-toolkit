import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  constellationLinks,
  hoverTrail,
  makeOverlay,
} from "./_shared";

const PRIMARY = "#3b82f6";
const SECONDARY = "#cbd5e1";
const GLOW = "rgba(59, 130, 246, 0.25)";

/** Moon drifts slowly across the upper sky on an arc — evokes the new lunar
 *  month silently arriving. */
function moonDriftAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const moon = svg.querySelector<SVGGElement>("[data-hny-moon]");
  const stars = svg.querySelectorAll<SVGCircleElement>("[data-hny-star]");
  const tl = ctx.gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } });
  if (moon) {
    tl.fromTo(moon, { x: -20, y: 12, opacity: 0.4 }, { x: 20, y: -8, opacity: 1, duration: 9 });
    tl.to(moon, { x: -20, y: 12, opacity: 0.4, duration: 9 });
  }
  // Each star twinkles independently on its own loop.
  stars.forEach((star, i) => {
    ctx.gsap.to(star, {
      opacity: 0.2 + (i % 3) * 0.25,
      duration: 1.2 + (i % 4) * 0.4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: i * 0.18,
    });
  });
  ctx.gsap.from(svg, { opacity: 0, duration: 1.2, ease: "power2.out" });
  return () => {
    tl.kill();
    if (moon) ctx.gsap.killTweensOf(moon);
    stars.forEach((s) => ctx.gsap.killTweensOf(s));
    ctx.gsap.killTweensOf(svg);
  };
}

const moonSky = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110" width="220" height="110" data-holiday-svg="hny-sky">
  <defs>
    <radialGradient id="hny-moon-glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="rgba(203, 213, 225, 0.6)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <!-- Star field, randomly arranged -->
  <g fill="#cbd5e1">
    <circle data-hny-star cx="20"  cy="22" r="1.4"/>
    <circle data-hny-star cx="48"  cy="14" r="1.0"/>
    <circle data-hny-star cx="75"  cy="32" r="1.6"/>
    <circle data-hny-star cx="98"  cy="18" r="1.2"/>
    <circle data-hny-star cx="142" cy="26" r="1.4"/>
    <circle data-hny-star cx="172" cy="14" r="1.0"/>
    <circle data-hny-star cx="195" cy="34" r="1.6"/>
    <circle data-hny-star cx="38"  cy="50" r="1.0"/>
    <circle data-hny-star cx="120" cy="62" r="1.2"/>
    <circle data-hny-star cx="180" cy="72" r="1.4"/>
    <circle data-hny-star cx="60"  cy="84" r="1.0"/>
    <circle data-hny-star cx="200" cy="90" r="1.2"/>
  </g>
  <!-- Drifting moon -->
  <g data-hny-moon transform="translate(110 55)">
    <circle r="36" fill="url(#hny-moon-glow)"/>
    <path d="M -16 -20 A 24 24 0 1 0 -16 20 A 18 18 0 1 1 -16 -20 Z" fill="#cbd5e1"/>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "hijri-new-year",
  name: "Hijri New Year",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 50, density: { enable: true } },
      color: { value: ["#cbd5e1", "#ffffff", "#93c5fd"] },
      opacity: { value: { min: 0.3, max: 0.95 }, animation: { enable: true, speed: 1.5 } },
      size: { value: { min: 1, max: 2.5 } },
      move: { enable: true, speed: 0.3, direction: "none" },
      shape: { type: "circle" },
      twinkle: { particles: { enable: true, frequency: 0.12, opacity: 1 } },
      // Linked constellation effect — short links between nearby stars.
      links: constellationLinks("#93c5fd", 0.22, 100),
    },
    interactivity: combineInteractivity(clickBurst({ quantity: 8 }), hoverTrail("#93c5fd", 1)),
  }),
  overlay: makeOverlay(moonSky, moonDriftAnimate, "top-center"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
