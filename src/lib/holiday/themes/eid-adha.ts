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
const GLOW = "rgba(16, 185, 129, 0.32)";

/** Eid Mubarak signature animation:
 *  - Whole banner fades + scales in.
 *  - Crescent glow breathes (opacity + scale yoyo).
 *  - Star slowly rotates and pulses with the glow.
 *  - Arabic calligraphy gets a soft serif-like entry (slide up + fade). */
function eidAdhaAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const glow = svg.querySelector<SVGCircleElement>("[data-ea-glow]");
  const star = svg.querySelector<SVGGElement>("[data-ea-star]");
  const moon = svg.querySelector<SVGCircleElement>("[data-ea-moon]");
  const text = svg.querySelector<SVGTextElement>("[data-ea-text]");
  const sub = svg.querySelector<SVGTextElement>("[data-ea-sub]");

  // Lock visible up front — defensive against StrictMode double-mount.
  ctx.gsap.set(svg, { opacity: 1 });

  const tl = ctx.gsap.timeline({ defaults: { ease: "power2.out" } });
  tl.fromTo(svg, { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 1 });

  if (moon)
    tl.fromTo(
      moon,
      { opacity: 0, scale: 0.7, transformOrigin: "140px 90px" },
      { opacity: 1, scale: 1, duration: 0.9 },
      0.2
    );
  if (text) tl.fromTo(text, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7 }, 0.5);
  if (sub) tl.fromTo(sub, { opacity: 0, y: 8 }, { opacity: 0.75, y: 0, duration: 0.6 }, 0.7);

  // Crescent glow breathes
  if (glow) {
    ctx.gsap.fromTo(
      glow,
      { opacity: 0.6, scale: 0.92, transformOrigin: "140px 90px" },
      {
        opacity: 1,
        scale: 1.18,
        duration: 2.6,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      }
    );
  }
  // Star slow continuous rotation
  if (star) {
    ctx.gsap.set(star, { transformOrigin: "200px 50px" });
    ctx.gsap.to(star, { rotation: 360, duration: 18, repeat: -1, ease: "none" });
  }

  return () => {
    tl.kill();
    if (glow) ctx.gsap.killTweensOf(glow);
    if (star) ctx.gsap.killTweensOf(star);
    if (moon) ctx.gsap.killTweensOf(moon);
    if (text) ctx.gsap.killTweensOf(text);
    if (sub) ctx.gsap.killTweensOf(sub);
    ctx.gsap.killTweensOf(svg);
  };
}

const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 220" width="340" height="266" data-holiday-svg="eid-adha" style="overflow:visible;filter:drop-shadow(0 8px 24px rgba(16,185,129,0.25));">
  <defs>
    <radialGradient id="ea-glow" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="${GLOW}"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <mask id="ea-crescent-mask" maskUnits="userSpaceOnUse" x="80" y="40" width="120" height="120">
      <rect x="80" y="40" width="120" height="120" fill="white"/>
      <!-- Offset disc carves a crescent opening on the right -->
      <circle cx="158" cy="90" r="32" fill="black"/>
    </mask>
  </defs>
  <!-- Glow halo behind the moon -->
  <circle data-ea-glow cx="140" cy="90" r="62" fill="url(#ea-glow)"/>
  <!-- Crescent moon (full disc + mask) -->
  <circle data-ea-moon cx="140" cy="90" r="42" fill="#a7f3d0" mask="url(#ea-crescent-mask)"/>
  <!-- 5-point accent star to the right of the crescent -->
  <g data-ea-star transform="translate(200 50)">
    <polygon points="0,-12 3.5,-3.7 12,-3.7 5,1.5 7.5,10 0,5 -7.5,10 -5,1.5 -12,-3.7 -3.5,-3.7" fill="${SECONDARY}"/>
  </g>
  <!-- Arabic calligraphy "Eid Mubarak" (serif fallback chain so it renders on every OS) -->
  <text data-ea-text x="140" y="178" text-anchor="middle"
        font-family="'Amiri','Scheherazade New','Noto Naskh Arabic','Traditional Arabic',Georgia,serif"
        font-size="36" font-weight="700" fill="${SECONDARY}" direction="rtl">عيد مبارك</text>
  <!-- English subtitle -->
  <text data-ea-sub x="140" y="204" text-anchor="middle"
        font-family="'Inter',sans-serif"
        font-size="10" font-weight="500" fill="${SECONDARY}" opacity="0.75" letter-spacing="6">EID AL-ADHA</text>
</svg>`;

const theme: HolidayTheme = {
  id: "eid-adha",
  name: "Eid al-Adha",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      // Drastic cut from 32 → 12. The signature centerpiece carries the
      // visual weight; particles are now ambient atmosphere, not a wall.
      number: { value: 12, density: { enable: true } },
      color: { value: ["#10b981", "#fbbf24", "#ffffff"] },
      opacity: { value: { min: 0.3, max: 0.7 }, animation: { enable: true, speed: 0.6 } },
      size: { value: { min: 1.5, max: 3 } },
      move: {
        enable: true,
        speed: { min: 0.15, max: 0.5 },
        direction: "top",
        outModes: { default: "out" },
      },
      shape: { type: ["circle", "star"] },
      // Constellation links removed — they read as noise without enough
      // density to form a clear network. Replaced visual interest with
      // the calligraphy centerpiece.
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 4 }),
      hoverAttract({ distance: 160, duration: 0.5 })
    ),
  }),
  overlay: makeOverlay(overlaySvg, eidAdhaAnimate, "top-center"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
