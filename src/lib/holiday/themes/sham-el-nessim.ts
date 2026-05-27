import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverRepel,
  makeOverlay,
  polygonPath,
} from "./_shared";

const PRIMARY = "#84cc16";
const SECONDARY = "#fef08a";
const GLOW = "rgba(132, 204, 22, 0.25)";

/** A rising sun: corona pulses, rays slowly rotate, whole sun lifts up from
 *  the horizon when the theme mounts. */
function risingSunAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const sun = svg.querySelector<SVGGElement>("[data-sun-disc]");
  const rays = svg.querySelector<SVGGElement>("[data-sun-rays]");
  const corona = svg.querySelector<SVGCircleElement>("[data-sun-corona]");

  const tl = ctx.gsap.timeline();
  if (sun) {
    tl.from(sun, { y: 40, opacity: 0, duration: 1.4, ease: "power3.out" });
  }
  if (rays) {
    ctx.gsap.set(rays, { transformOrigin: "60px 70px" });
    ctx.gsap.to(rays, {
      rotation: 360,
      duration: 60,
      repeat: -1,
      ease: "none",
    });
  }
  if (corona) {
    tl.to(
      corona,
      {
        opacity: 0.85,
        scale: 1.08,
        transformOrigin: "60px 70px",
        duration: 3,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      },
      0.6
    );
  }
  return () => {
    tl.kill();
    if (sun) ctx.gsap.killTweensOf(sun);
    if (rays) ctx.gsap.killTweensOf(rays);
    if (corona) ctx.gsap.killTweensOf(corona);
  };
}

const risingSun = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="280" height="232" data-holiday-svg="rising-sun" style="overflow:visible;">
  <defs>
    <radialGradient id="sun-corona-grad" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="rgba(254, 240, 138, 0.7)"/>
      <stop offset="60%" stop-color="rgba(132, 204, 22, 0.25)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <circle data-sun-corona cx="60" cy="70" r="46" fill="url(#sun-corona-grad)" opacity="0.55"/>
  <g data-sun-rays stroke="#fef08a" stroke-width="2" stroke-linecap="round" opacity="0.7">
    ${Array.from({ length: 12 }, (_, i) => {
      const deg = i * 30;
      return `<line x1="60" y1="34" x2="60" y2="22" transform="rotate(${deg} 60 70)"/>`;
    }).join("")}
  </g>
  <g data-sun-disc>
    <circle cx="60" cy="70" r="20" fill="#fef08a"/>
    <circle cx="60" cy="70" r="20" fill="none" stroke="#84cc16" stroke-width="1.5" opacity="0.6"/>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "sham-el-nessim",
  name: "Sham El-Nessim",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 12, density: { enable: true } },
      color: { value: ["#84cc16", "#fef08a", "#bef264"] },
      opacity: { value: { min: 0.35, max: 0.8 } },
      size: { value: { min: 10, max: 18 } },
      move: {
        enable: true,
        speed: { min: 0.5, max: 1.4 },
        direction: "bottom",
        outModes: { default: "out" },
        gravity: { enable: true, acceleration: 1.2 },
        // Leaves carried in waves across the screen — feels like wind.
        path: polygonPath({ sides: 10, turnSteps: 20, angle: 50, delay: 0.05 }),
      },
      // Circles for leaves, stars for flowers — emoji glyphs render flat on
      // Windows sans-serif. The rising-sun SVG overlay carries the spring
      // theming.
      shape: { type: ["circle", "star"] },
      wobble: { enable: true, distance: 10, speed: 4 },
      rotate: { value: { min: 0, max: 360 }, animation: { enable: true, speed: 3, sync: false } },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 8 }),
      // Hover acts as a "wind gust" — leaves flee the cursor.
      hoverRepel({ distance: 130, duration: 0.5 })
    ),
  }),
  overlay: makeOverlay(risingSun, risingSunAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
