import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverRepel,
  makeOverlay,
} from "./_shared";

const PRIMARY = "#f97316";
const SECONDARY = "#a855f7";
const GLOW = "rgba(249, 115, 22, 0.3)";

/** Three bats cross the screen on slightly different curved paths, with
 *  staggered start times and wing-flapping. The whole overlay spans the full
 *  viewport — the bats fly across it. */
function batSwarmAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const bats = svg.querySelectorAll<SVGGElement>("[data-hw-bat]");
  const moon = svg.querySelector<SVGGElement>("[data-hw-moon]");
  // Tween, Timeline and from() all share an Animation base class with .kill().
  // Use Animation as the common type instead of casting Timelines to Tween.
  const tweens: gsap.core.Animation[] = [];

  // Each bat traces its own keyframed flight path, looping forever. The y
  // values curve up-then-down so each bat dips through the screen rather than
  // floating in a straight line.
  bats.forEach((bat, i) => {
    const yStart = 18 + i * 14;
    const yMid = yStart - 10 + (i % 2 === 0 ? -6 : 6);
    const wingsTl = ctx.gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } });
    const wings = bat.querySelectorAll<SVGPathElement>("[data-hw-wing]");
    wingsTl
      .to(wings, { scaleY: 0.5, duration: 0.18, transformOrigin: "50% 50%" })
      .to(wings, { scaleY: 1.0, duration: 0.18 });
    tweens.push(wingsTl);

    const flight = ctx.gsap.fromTo(
      bat,
      { x: -60, y: yStart },
      {
        keyframes: [
          { x: 200, y: yMid },
          { x: 500, y: yStart + 4 },
          { x: 800, y: yMid - 4 },
          { x: 1280, y: yStart },
        ],
        duration: 14 + i * 1.5,
        repeat: -1,
        ease: "none",
        delay: i * 4.5,
      }
    );
    tweens.push(flight);
  });

  if (moon) {
    ctx.gsap.to(moon, {
      opacity: 0.9,
      duration: 2.4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
    tweens.push(
      ctx.gsap.from(moon, {
        opacity: 0,
        scale: 0.6,
        transformOrigin: "60px 60px",
        duration: 1.2,
        ease: "back.out(1.4)",
      })
    );
  }

  return () => {
    tweens.forEach((t) => {
      try {
        t.kill();
      } catch {
        /* ignore */
      }
    });
    bats.forEach((b) => ctx.gsap.killTweensOf(b));
    if (moon) ctx.gsap.killTweensOf(moon);
  };
}

/** A single bat as an SVG group with two wing paths so they can flap. */
function bat(id: number): string {
  return `<g data-hw-bat data-hw-bat-${id} transform="translate(-60 30)">
    <g fill="#2b0f3a">
      <path data-hw-wing d="M 0 0 Q -8 -8 -16 -4 Q -14 2 -8 4 Q -4 4 0 2 Z"/>
      <path data-hw-wing d="M 0 0 Q 8 -8 16 -4 Q 14 2 8 4 Q 4 4 0 2 Z"/>
      <circle cx="0" cy="2" r="3"/>
      <path d="M -2 -2 L -1 -4 L 0 -2 L 1 -4 L 2 -2 Z"/>
    </g>
  </g>`;
}

/** Full-viewport overlay so the bats can fly the full width.
 *  Includes a small moon in the top-right corner of the viewport. */
const halloweenSky = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="100%" height="100%" preserveAspectRatio="none" data-holiday-svg="halloween-sky">
  <!-- Bats fly across the upper third of the viewport -->
  ${bat(1)}${bat(2)}${bat(3)}
  <!-- Moon, fixed at top-right of the viewport region -->
  <g data-hw-moon transform="translate(1170 60)">
    <defs>
      <radialGradient id="hw-moon-glow" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stop-color="rgba(168, 85, 247, 0.35)"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
    </defs>
    <circle cx="0" cy="0" r="50" fill="url(#hw-moon-glow)"/>
    <circle cx="0" cy="0" r="28" fill="#fde68a" opacity="0.85"/>
    <circle cx="-6" cy="-4" r="3" fill="#a855f7" opacity="0.35"/>
    <circle cx="6" cy="6" r="2" fill="#a855f7" opacity="0.3"/>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "halloween",
  name: "Halloween",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 34, density: { enable: true } },
      color: { value: ["#f97316", "#a855f7", "#fbbf24"] },
      opacity: { value: { min: 0.4, max: 0.85 } },
      size: { value: { min: 10, max: 16 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 1.2 },
        direction: "none",
        outModes: { default: "out" },
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["🦇", "🎃", "👻"], font: "sans-serif" } },
      },
      rotate: { value: { min: -30, max: 30 }, animation: { enable: true, speed: 3, sync: false } },
    },
    interactivity: combineInteractivity(
      // Click = ghost puff (8 particles)
      clickBurst({ quantity: 10 }),
      // Hover = particles flee (spooky)
      hoverRepel({ distance: 160, duration: 0.5 })
    ),
  }),
  // Full-viewport overlay so bats can fly edge-to-edge. We render at
  // `position: "center"` but the SVG itself is 100% width via preserveAspectRatio.
  overlay: makeOverlay(
    halloweenSky,
    batSwarmAnimate,
    "center",
    "!inset-0 !translate-x-0 !translate-y-0 !top-0 !left-0 w-screen h-screen"
  ),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
