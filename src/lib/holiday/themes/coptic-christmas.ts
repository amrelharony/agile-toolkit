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

const PRIMARY = "#e63946";
const SECONDARY = "#2a9d8f";
const GLOW = "rgba(230, 57, 70, 0.25)";

/** A six-fold snowflake slowly rotates while individual arms breathe via
 *  opacity-stagger. The whole SVG fades in on mount. */
function snowflakeAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const flake = svg.querySelector<SVGGElement>("[data-cc-flake]");
  const arms = svg.querySelectorAll<SVGElement>("[data-cc-arm]");

  if (flake) {
    ctx.gsap.set(flake, { transformOrigin: "60px 60px" });
    ctx.gsap.to(flake, {
      rotation: 360,
      duration: 22,
      repeat: -1,
      ease: "none",
    });
  }
  arms.forEach((arm, i) => {
    ctx.gsap.to(arm, {
      opacity: 0.55,
      duration: 1.4 + i * 0.12,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: i * 0.15,
    });
  });
  ctx.gsap.from(svg, {
    opacity: 0,
    scale: 0.5,
    transformOrigin: "50% 50%",
    duration: 1.2,
    ease: "back.out(1.4)",
  });
  return () => {
    if (flake) ctx.gsap.killTweensOf(flake);
    arms.forEach((a) => ctx.gsap.killTweensOf(a));
    ctx.gsap.killTweensOf(svg);
  };
}

const snowflakeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="170" height="170" data-holiday-svg="snowflake" style="filter:drop-shadow(0 0 12px rgba(255,255,255,0.7));">
  <g data-cc-flake stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round">
    ${[0, 60, 120, 180, 240, 300]
      .map(
        (rot) => `<g data-cc-arm transform="rotate(${rot} 60 60)">
      <line x1="60" y1="60" x2="60" y2="14"/>
      <line x1="60" y1="22" x2="54" y2="14"/>
      <line x1="60" y1="22" x2="66" y2="14"/>
      <line x1="60" y1="34" x2="52" y2="28"/>
      <line x1="60" y1="34" x2="68" y2="28"/>
      <line x1="60" y1="46" x2="54" y2="42"/>
      <line x1="60" y1="46" x2="66" y2="42"/>
    </g>`
      )
      .join("")}
    <circle cx="60" cy="60" r="3" fill="#ffffff" stroke="none"/>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "coptic-christmas",
  name: "Coptic Christmas",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 50, density: { enable: true } },
      color: { value: "#ffffff" },
      opacity: { value: { min: 0.4, max: 0.9 } },
      size: { value: { min: 2, max: 5 } },
      move: {
        enable: true,
        speed: { min: 0.6, max: 1.6 },
        direction: "bottom",
        outModes: { default: "out" },
        // Soft drift so flakes meander rather than fall straight.
        path: polygonPath({ sides: 5, turnSteps: 36, angle: 25, delay: 0.2 }),
      },
      shape: { type: "circle" },
      wobble: { enable: true, distance: 8, speed: 4 },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 8 }),
      hoverAttract({ distance: 150, duration: 0.5 })
    ),
  }),
  overlay: makeOverlay(snowflakeSvg, snowflakeAnimate, "top-left"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
