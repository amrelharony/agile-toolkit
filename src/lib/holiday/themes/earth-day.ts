import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverRepel,
  makeOverlay,
} from "./_shared";

const PRIMARY = "#52b788";
const SECONDARY = "#2d6a4f";
const GLOW = "rgba(82, 183, 136, 0.25)";

/** Stylized globe slowly rotates — only the continents move (the ocean disk
 *  stays put), which gives it a "spinning" feel without geometric weirdness. */
function rotatingGlobeAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const land = svg.querySelector<SVGGElement>("[data-ed-land]");
  const halo = svg.querySelector<SVGCircleElement>("[data-ed-halo]");
  const sparks = svg.querySelectorAll<SVGCircleElement>("[data-ed-spark]");

  const tl = ctx.gsap.timeline();
  if (land) {
    ctx.gsap.set(land, { transformOrigin: "60px 60px" });
    ctx.gsap.to(land, {
      rotation: 360,
      duration: 40,
      repeat: -1,
      ease: "none",
    });
    tl.from(land, {
      opacity: 0,
      scale: 0.8,
      transformOrigin: "60px 60px",
      duration: 1.1,
      ease: "back.out(1.4)",
    });
  }
  if (halo) {
    tl.to(
      halo,
      {
        opacity: 0.6,
        scale: 1.08,
        transformOrigin: "60px 60px",
        duration: 3,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      },
      0
    );
  }
  sparks.forEach((s, i) => {
    ctx.gsap.to(s, {
      opacity: 0.2,
      duration: 1.3 + i * 0.2,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: i * 0.4,
    });
  });
  return () => {
    tl.kill();
    if (land) ctx.gsap.killTweensOf(land);
    if (halo) ctx.gsap.killTweensOf(halo);
    sparks.forEach((s) => ctx.gsap.killTweensOf(s));
  };
}

const globeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="170" height="170" data-holiday-svg="earth-globe" style="filter:drop-shadow(0 0 12px rgba(82, 183, 136, 0.5));">
  <defs>
    <radialGradient id="ed-halo-grad" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="rgba(149, 213, 178, 0.45)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <radialGradient id="ed-ocean" cx="38%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#74c69d"/>
      <stop offset="100%" stop-color="#2d6a4f"/>
    </radialGradient>
    <clipPath id="ed-globe-clip"><circle cx="60" cy="60" r="42"/></clipPath>
  </defs>
  <circle data-ed-halo cx="60" cy="60" r="54" fill="url(#ed-halo-grad)" opacity="0.4"/>
  <circle cx="60" cy="60" r="42" fill="url(#ed-ocean)"/>
  <g data-ed-land clip-path="url(#ed-globe-clip)" fill="#52b788">
    <!-- Simplified continents — they're abstract on purpose -->
    <path d="M 20 40 Q 32 32, 42 38 Q 50 44, 46 56 Q 38 60, 28 56 Q 22 48, 20 40 Z"/>
    <path d="M 60 32 Q 78 38, 80 52 Q 70 62, 58 56 Q 50 48, 60 32 Z"/>
    <path d="M 70 70 Q 84 72, 86 82 Q 78 92, 68 88 Q 62 80, 70 70 Z"/>
    <path d="M 30 78 Q 42 80, 46 90 Q 38 96, 28 92 Q 24 84, 30 78 Z"/>
  </g>
  <circle cx="60" cy="60" r="42" fill="none" stroke="#95d5b2" stroke-width="1" opacity="0.4"/>
  <!-- Subtle orbiting sparks (life around the planet) -->
  <circle data-ed-spark cx="14" cy="60" r="2" fill="#74c69d" opacity="0.8"/>
  <circle data-ed-spark cx="106" cy="60" r="1.8" fill="#74c69d" opacity="0.7"/>
  <circle data-ed-spark cx="60" cy="14" r="1.5" fill="#95d5b2" opacity="0.7"/>
  <circle data-ed-spark cx="60" cy="106" r="1.5" fill="#95d5b2" opacity="0.6"/>
</svg>`;

const theme: HolidayTheme = {
  id: "earth-day",
  name: "Earth Day",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 42, density: { enable: true } },
      color: { value: ["#52b788", "#95d5b2", "#40916c", "#74c69d"] },
      opacity: { value: { min: 0.5, max: 0.9 } },
      size: { value: { min: 8, max: 16 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 1.2 },
        direction: "bottom",
        outModes: { default: "out" },
        gravity: { enable: true, acceleration: 1.8 },
        path: {
          enable: true,
          delay: { value: 0.05 },
          options: { sides: 12, turnSteps: 18, angle: 60 },
        },
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["🍃", "🌿"], font: "sans-serif" } },
      },
      rotate: { value: { min: 0, max: 360 }, animation: { enable: true, speed: 4 } },
      wobble: { enable: true, distance: 14, speed: 6 },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 8 }),
      // Hover = wind gust — leaves flee the cursor in a swirl.
      hoverRepel({ distance: 150, duration: 0.55 })
    ),
  }),
  overlay: makeOverlay(globeSvg, rotatingGlobeAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
