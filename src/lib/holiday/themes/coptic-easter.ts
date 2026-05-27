import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverAttract,
  makeOverlay,
  polygonPath,
} from "./_shared";

const PRIMARY = "#f472b6";
const SECONDARY = "#fde68a";
const GLOW = "rgba(244, 114, 182, 0.25)";

/** Ornate cross radiates a soft halo and pulses gently. Petals drift down
 *  through the cross silhouette via the particle layer behind it. */
function ornateCrossAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const halo = svg.querySelector<SVGCircleElement>("[data-ce-halo]");
  const rays = svg.querySelectorAll<SVGLineElement>("[data-ce-ray]");
  const cross = svg.querySelector<SVGGElement>("[data-ce-cross]");

  const tl = ctx.gsap.timeline();
  if (cross) {
    ctx.gsap.set(cross, { transformOrigin: "60px 60px" });
    tl.from(cross, { opacity: 0, scale: 0.8, duration: 1, ease: "back.out(1.4)" });
  }
  if (halo) {
    tl.to(
      halo,
      {
        opacity: 0.7,
        scale: 1.12,
        transformOrigin: "60px 60px",
        duration: 2.4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      },
      0.4
    );
  }
  rays.forEach((ray, i) => {
    ctx.gsap.to(ray, {
      opacity: 0.3,
      duration: 1.6 + i * 0.1,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: i * 0.15,
    });
  });
  return () => {
    tl.kill();
    if (cross) ctx.gsap.killTweensOf(cross);
    if (halo) ctx.gsap.killTweensOf(halo);
    rays.forEach((r) => ctx.gsap.killTweensOf(r));
  };
}

const ornateCross = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="150" height="150" data-holiday-svg="coptic-cross">
  <defs>
    <radialGradient id="ce-halo-grad" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="rgba(253, 230, 138, 0.55)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <circle data-ce-halo cx="60" cy="60" r="50" fill="url(#ce-halo-grad)" opacity="0.45"/>
  <!-- Light rays radiating outward -->
  <g stroke="#fde68a" stroke-width="1" stroke-linecap="round" opacity="0.55">
    ${[0, 45, 90, 135, 180, 225, 270, 315]
      .map(
        (deg) =>
          `<line data-ce-ray x1="60" y1="60" x2="60" y2="14" transform="rotate(${deg} 60 60)"/>`
      )
      .join("")}
  </g>
  <!-- Ornate Coptic-style cross with circular ends -->
  <g data-ce-cross fill="#f472b6" stroke="#fde68a" stroke-width="1">
    <rect x="56" y="32" width="8" height="56" rx="2"/>
    <rect x="36" y="50" width="48" height="8" rx="2"/>
    <circle cx="60" cy="32" r="5" fill="#fde68a"/>
    <circle cx="60" cy="88" r="5" fill="#fde68a"/>
    <circle cx="36" cy="54" r="5" fill="#fde68a"/>
    <circle cx="84" cy="54" r="5" fill="#fde68a"/>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "coptic-easter",
  name: "Coptic Easter",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 36, density: { enable: true } },
      color: { value: ["#f472b6", "#fde68a", "#c084fc", "#fbcfe8"] },
      opacity: { value: { min: 0.4, max: 0.85 } },
      size: { value: { min: 10, max: 18 } },
      move: {
        enable: true,
        speed: { min: 0.6, max: 1.5 },
        direction: "bottom",
        outModes: { default: "out" },
        gravity: { enable: true, acceleration: 1.4 },
        // Butterfly-like wandering — petals don't fall straight.
        path: polygonPath({ sides: 8, turnSteps: 25, angle: 40, delay: 0.05 }),
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["🌸", "🌷"], font: "sans-serif" } },
      },
      wobble: { enable: true, distance: 12, speed: 5 },
      rotate: { value: { min: 0, max: 360 }, animation: { enable: true, speed: 4, sync: false } },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 8 }),
      hoverAttract({ distance: 180, duration: 0.6 })
    ),
  }),
  overlay: makeOverlay(ornateCross, ornateCrossAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
