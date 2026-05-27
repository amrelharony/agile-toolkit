import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverAttract,
  makeOverlay,
} from "./_shared";

const PRIMARY = "#10b981";
const SECONDARY = "#fbbf24";
const GLOW = "rgba(251, 191, 36, 0.25)";

/** A geometric Islamic 8-point star slowly rotates with a breathing glow. */
function geometricStarAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const star = svg.querySelector<SVGGElement>("[data-mawlid-star]");
  const ring = svg.querySelector<SVGCircleElement>("[data-mawlid-ring]");
  const tl = ctx.gsap.timeline({ defaults: { ease: "sine.inOut" } });
  if (star) {
    ctx.gsap.set(star, { transformOrigin: "60px 60px" });
    ctx.gsap.to(star, { rotation: 360, duration: 28, repeat: -1, ease: "none" });
    tl.from(star, { opacity: 0, scale: 0.7, duration: 0.9, ease: "power2.out" });
  }
  if (ring) {
    tl.to(
      ring,
      {
        opacity: 0.6,
        scale: 1.08,
        transformOrigin: "60px 60px",
        duration: 2.2,
        repeat: -1,
        yoyo: true,
      },
      0.4
    );
  }
  return () => {
    tl.kill();
    if (star) ctx.gsap.killTweensOf(star);
    if (ring) ctx.gsap.killTweensOf(ring);
  };
}

const geometricStar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240" data-holiday-svg="mawlid-star" style="overflow:visible;">
  <defs>
    <radialGradient id="mwl-glow" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="rgba(251, 191, 36, 0.4)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <circle data-mawlid-ring cx="60" cy="60" r="50" fill="url(#mwl-glow)" opacity="0.4"/>
  <g data-mawlid-star fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.95">
    <!-- Two overlaid squares form the 8-point Khatim Sulayman star -->
    <rect x="22" y="22" width="76" height="76" transform="rotate(0 60 60)"/>
    <rect x="22" y="22" width="76" height="76" transform="rotate(45 60 60)"/>
    <circle cx="60" cy="60" r="20" stroke="#10b981" stroke-width="1"/>
    <circle cx="60" cy="60" r="38" stroke="#10b981" stroke-width="0.8" stroke-dasharray="2 4"/>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "mawlid",
  name: "Mawlid al-Nabi",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 12, density: { enable: true } },
      color: { value: ["#fbbf24", "#10b981", "#ffffff"] },
      opacity: { value: { min: 0.4, max: 0.9 }, animation: { enable: true, speed: 0.8 } },
      size: { value: { min: 2, max: 5 } },
      move: { enable: true, speed: 0.6, direction: "none" },
      shape: { type: "star" },
      // No constellation links — they read as noise here. The geometric
      // 8-point star overlay carries the recognizable iconography.
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 10 }),
      hoverAttract({ distance: 180, duration: 0.5 })
    ),
  }),
  overlay: makeOverlay(geometricStar, geometricStarAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
