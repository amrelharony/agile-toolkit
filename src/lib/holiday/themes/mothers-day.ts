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

const PRIMARY = "#ff6b9d";
const SECONDARY = "#c9184a";
const GLOW = "rgba(255, 107, 157, 0.25)";

/** Big heart beats like a pulse (2x scale up + return). Halo softly throbs. */
function heartBeatAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const heart = svg.querySelector<SVGGElement>("[data-md-heart]");
  const halo = svg.querySelector<SVGCircleElement>("[data-md-halo]");
  const sub = svg.querySelector<SVGGElement>("[data-md-sub]");

  const tl = ctx.gsap.timeline();
  if (heart) {
    ctx.gsap.set(heart, { transformOrigin: "60px 64px" });
    tl.from(heart, { opacity: 0, scale: 0.7, duration: 0.8, ease: "back.out(1.5)" });
    // Two-stage beat: quick up, soft return — matches a real heartbeat rhythm.
    const beat = ctx.gsap.timeline({ repeat: -1, defaults: { ease: "power2.inOut" } });
    beat
      .to(heart, { scale: 1.14, duration: 0.16 })
      .to(heart, { scale: 1.0, duration: 0.36 })
      .to(heart, { scale: 1.08, duration: 0.14 })
      .to(heart, { scale: 1.0, duration: 0.74 });
    tl.add(beat, 0.8);
  }
  if (halo) {
    ctx.gsap.set(halo, { transformOrigin: "60px 60px" });
    tl.to(
      halo,
      { opacity: 0.75, scale: 1.18, duration: 1.8, repeat: -1, yoyo: true, ease: "sine.inOut" },
      0
    );
  }
  if (sub) {
    tl.from(sub, { opacity: 0, y: 6, duration: 0.6, ease: "power2.out" }, 0.5);
  }
  return () => {
    tl.kill();
    if (heart) ctx.gsap.killTweensOf(heart);
    if (halo) ctx.gsap.killTweensOf(halo);
    if (sub) ctx.gsap.killTweensOf(sub);
  };
}

const heartSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" width="160" height="186" data-holiday-svg="mothers-heart" style="filter:drop-shadow(0 4px 16px rgba(255, 107, 157, 0.6));">
  <defs>
    <radialGradient id="md-halo-grad" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="rgba(255, 179, 198, 0.5)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <linearGradient id="md-heart-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff6b9d"/>
      <stop offset="100%" stop-color="#c9184a"/>
    </linearGradient>
  </defs>
  <circle data-md-halo cx="60" cy="60" r="48" fill="url(#md-halo-grad)" opacity="0.5"/>
  <g data-md-heart>
    <path d="M 60 96 C 60 96, 18 72, 18 42 C 18 24, 36 18, 60 38 C 84 18, 102 24, 102 42 C 102 72, 60 96, 60 96 Z" fill="url(#md-heart-grad)"/>
    <path d="M 50 36 Q 56 30 60 38 Q 64 30 70 36" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.5"/>
  </g>
  <g data-md-sub>
    <text x="50%" y="118" text-anchor="middle" font-family="'Inter', sans-serif" font-size="9" font-weight="500" fill="#ff6b9d" letter-spacing="5">MOTHER'S DAY</text>
  </g>
</svg>`;

const theme: HolidayTheme = {
  id: "mothers-day",
  name: "Mother's Day",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 38, density: { enable: true } },
      color: { value: ["#ff6b9d", "#ffb3c6", "#ff8fab"] },
      opacity: { value: { min: 0.4, max: 0.85 } },
      size: { value: { min: 6, max: 14 } },
      move: {
        enable: true,
        speed: { min: 0.8, max: 1.6 },
        direction: "bottom",
        outModes: { default: "out" },
        path: polygonPath({ sides: 8, turnSteps: 28, angle: 35, delay: 0.08 }),
      },
      shape: {
        type: ["character", "circle"],
        options: { character: { value: ["❤", "🌸"], font: "sans-serif", weight: "400" } },
      },
      rotate: { value: { min: -20, max: 20 }, animation: { enable: true, speed: 3 } },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 10 }),
      // Hearts gravitate toward the cursor — the signature mom's-day moment.
      hoverAttract({ distance: 220, duration: 0.7 })
    ),
  }),
  overlay: makeOverlay(heartSvg, heartBeatAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
