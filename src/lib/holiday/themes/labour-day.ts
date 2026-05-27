import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverRepel,
  makeOverlay,
} from "./_shared";

const PRIMARY = "#dc2626";
const SECONDARY = "#f87171";
const GLOW = "rgba(220, 38, 38, 0.22)";

/** Red banner sweeps in from the left and gently waves. */
function workersBannerAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const banner = svg.querySelector<SVGGElement>("[data-ld-banner]");
  const sparkle = svg.querySelectorAll<SVGCircleElement>("[data-ld-spark]");
  const tl = ctx.gsap.timeline();
  if (banner) {
    ctx.gsap.set(banner, { transformOrigin: "0% 50%" });
    tl.from(banner, { x: -80, opacity: 0, duration: 1, ease: "power3.out" });
    tl.to(
      banner,
      { skewY: 2, scaleX: 1.02, duration: 1.8, repeat: -1, yoyo: true, ease: "sine.inOut" },
      1
    );
  }
  sparkle.forEach((s, i) => {
    ctx.gsap.to(s, {
      opacity: 0.3,
      duration: 0.9 + i * 0.2,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: i * 0.3,
    });
  });
  return () => {
    tl.kill();
    if (banner) ctx.gsap.killTweensOf(banner);
    sparkle.forEach((s) => ctx.gsap.killTweensOf(s));
  };
}

const workersBanner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 80" width="280" height="124" data-holiday-svg="labour-banner" style="overflow:visible;filter:drop-shadow(0 6px 18px rgba(0,0,0,0.4));">
  <g data-ld-banner>
    <path d="M 4 4 L 168 4 L 176 36 L 168 68 L 4 68 Z" fill="#dc2626"/>
    <path d="M 4 4 L 168 4 L 176 36 L 168 68 L 4 68 Z" fill="url(#ld-shade)" opacity="0.4"/>
    <text x="86" y="44" text-anchor="middle" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff" letter-spacing="3">LABOUR</text>
  </g>
  <defs>
    <linearGradient id="ld-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.3)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.3)"/>
    </linearGradient>
  </defs>
  <!-- Sparkles around the banner -->
  <circle data-ld-spark cx="12" cy="14" r="1.5" fill="#fde047" opacity="0.7"/>
  <circle data-ld-spark cx="172" cy="20" r="1.2" fill="#fde047" opacity="0.6"/>
  <circle data-ld-spark cx="158" cy="64" r="1.5" fill="#fde047" opacity="0.7"/>
  <circle data-ld-spark cx="20" cy="60" r="1.3" fill="#fde047" opacity="0.6"/>
</svg>`;

const theme: HolidayTheme = {
  id: "labour-day",
  name: "Labour Day",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      number: { value: 10, density: { enable: true } },
      color: { value: ["#dc2626", "#ef4444", "#fca5a5", "#fde047"] },
      opacity: { value: { min: 0.3, max: 0.7 }, animation: { enable: true, speed: 0.8 } },
      size: { value: { min: 2, max: 4 } },
      move: {
        enable: true,
        speed: { min: 0.4, max: 0.9 },
        direction: "top",
        outModes: { default: "out" },
      },
      shape: { type: "circle" },
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 8 }),
      hoverRepel({ distance: 120, duration: 0.4 })
    ),
  }),
  overlay: makeOverlay(workersBanner, workersBannerAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
