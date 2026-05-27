import type { HolidayOverlayContext, HolidayTheme } from "../types";
import {
  accentTokens,
  baseParticleConfig,
  clickBurst,
  combineInteractivity,
  hoverAttract,
  makeOverlay,
} from "./_shared";

const PRIMARY = "#f59e0b";
const SECONDARY = "#7c3aed";
const GLOW = "rgba(245, 158, 11, 0.32)";

/** Lantern swings gently, body glow breathes, light filaments pulse. */
function ramadanLanternAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const chain = svg.querySelector<SVGGElement>("[data-rm-anchor]");
  const lantern = svg.querySelector<SVGGElement>("[data-rm-lantern]");
  const flame = svg.querySelector<SVGCircleElement>("[data-rm-flame]");
  const glow = svg.querySelector<SVGEllipseElement>("[data-rm-glow]");
  const text = svg.querySelector<SVGTextElement>("[data-rm-text]");

  ctx.gsap.set(svg, { opacity: 1 });
  const tl = ctx.gsap.timeline({ defaults: { ease: "power2.out" } });
  tl.fromTo(svg, { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: 1.1 });
  if (text) tl.fromTo(text, { opacity: 0, y: 10 }, { opacity: 0.85, y: 0, duration: 0.7 }, 0.6);

  // Pendulum swing — uses the top anchor as pivot.
  if (chain) {
    ctx.gsap.set(chain, { transformOrigin: "120px 8px" });
    ctx.gsap.fromTo(
      chain,
      { rotation: -3.5 },
      {
        rotation: 3.5,
        duration: 3.4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      }
    );
  }
  // Flame core breathes
  if (flame) {
    ctx.gsap.fromTo(
      flame,
      { opacity: 0.65, scale: 0.92, transformOrigin: "120px 130px" },
      { opacity: 1, scale: 1.12, duration: 1.4, repeat: -1, yoyo: true, ease: "sine.inOut" }
    );
  }
  // Halo / light spill on the ground
  if (glow) {
    ctx.gsap.fromTo(
      glow,
      { opacity: 0.45, scale: 0.92, transformOrigin: "120px 130px" },
      { opacity: 0.85, scale: 1.08, duration: 2.4, repeat: -1, yoyo: true, ease: "sine.inOut" }
    );
  }
  return () => {
    tl.kill();
    if (chain) ctx.gsap.killTweensOf(chain);
    if (lantern) ctx.gsap.killTweensOf(lantern);
    if (flame) ctx.gsap.killTweensOf(flame);
    if (glow) ctx.gsap.killTweensOf(glow);
    if (text) ctx.gsap.killTweensOf(text);
    ctx.gsap.killTweensOf(svg);
  };
}

const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 340" width="220" height="312" data-holiday-svg="ramadan-lantern" style="overflow:visible;filter:drop-shadow(0 12px 24px rgba(245,158,11,0.35));">
  <defs>
    <radialGradient id="rm-flame-grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fef3c7"/>
      <stop offset="50%" stop-color="#fcd34d"/>
      <stop offset="100%" stop-color="rgba(245,158,11,0.6)"/>
    </radialGradient>
    <radialGradient id="rm-glow-grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(252,211,77,0.55)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <linearGradient id="rm-body-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <!-- Whole chain+lantern pivots on the top anchor -->
  <g data-rm-anchor>
    <!-- Chain from ceiling -->
    <line x1="120" y1="8" x2="120" y2="50" stroke="#a16207" stroke-width="1.5"/>
    <circle cx="120" cy="10" r="3" fill="#a16207"/>
    <circle cx="120" cy="20" r="2.5" fill="#a16207"/>
    <circle cx="120" cy="30" r="2.5" fill="#a16207"/>
    <circle cx="120" cy="40" r="2.5" fill="#a16207"/>

    <g data-rm-lantern>
      <!-- Top cap -->
      <path d="M 100 52 L 140 52 L 145 60 L 95 60 Z" fill="#b45309"/>
      <rect x="98" y="60" width="44" height="6" fill="#b45309"/>
      <!-- Body (lantern shape: hex / barrel) -->
      <path d="M 88 70 Q 120 64 152 70 L 156 130 Q 120 138 84 130 Z" fill="url(#rm-body-grad)"/>
      <!-- Outer body trim -->
      <path d="M 88 70 Q 120 64 152 70 L 156 130 Q 120 138 84 130 Z" fill="none" stroke="#7c2d12" stroke-width="1.2"/>
      <!-- Window cutouts (where the light shines through) -->
      <g fill="#fef3c7" opacity="0.85">
        <ellipse cx="104" cy="100" rx="6" ry="14"/>
        <ellipse cx="120" cy="100" rx="6" ry="16"/>
        <ellipse cx="136" cy="100" rx="6" ry="14"/>
      </g>
      <!-- Decorative metalwork -->
      <g stroke="#7c2d12" stroke-width="1" fill="none" opacity="0.6">
        <line x1="92" y1="80" x2="148" y2="80"/>
        <line x1="92" y1="118" x2="148" y2="118"/>
      </g>
      <!-- Inner flame disc — animated -->
      <circle data-rm-flame cx="120" cy="100" r="14" fill="url(#rm-flame-grad)"/>
      <!-- Bottom finial -->
      <rect x="100" y="130" width="40" height="6" fill="#b45309"/>
      <path d="M 110 136 L 130 136 L 124 148 L 116 148 Z" fill="#b45309"/>
      <circle cx="120" cy="152" r="3.5" fill="#a16207"/>
    </g>
  </g>
  <!-- Soft halo spilled below the lantern -->
  <ellipse data-rm-glow cx="120" cy="200" rx="110" ry="56" fill="url(#rm-glow-grad)"/>
  <!-- Subtitle -->
  <text data-rm-text x="120" y="278" text-anchor="middle"
        font-family="'Amiri','Scheherazade New','Noto Naskh Arabic',Georgia,serif"
        font-size="28" font-weight="700" fill="${PRIMARY}" direction="rtl">رمضان كريم</text>
  <text x="120" y="306" text-anchor="middle"
        font-family="'Inter',sans-serif"
        font-size="10" font-weight="500" fill="${PRIMARY}" opacity="0.7" letter-spacing="6">RAMADAN</text>
</svg>`;

const theme: HolidayTheme = {
  id: "ramadan",
  name: "Ramadan",
  accent: { primary: PRIMARY, secondary: SECONDARY, glow: GLOW },
  cssTokens: accentTokens(PRIMARY, SECONDARY, GLOW),
  particleConfig: baseParticleConfig({
    particles: {
      // Drastic cut 22 → 10. Lantern carries the visual weight.
      number: { value: 10, density: { enable: true } },
      color: { value: ["#fbbf24", "#fcd34d", "#fef3c7"] },
      opacity: { value: { min: 0.3, max: 0.7 }, animation: { enable: true, speed: 0.5 } },
      size: { value: { min: 1.5, max: 3 } },
      move: {
        enable: true,
        speed: { min: 0.15, max: 0.5 },
        direction: "top",
        outModes: { default: "out" },
      },
      shape: { type: "circle" },
      // Emitter ember stream removed — it added noise without payoff. The
      // lantern's pulsing flame + halo is the "warmth" anchor now.
    },
    interactivity: combineInteractivity(
      clickBurst({ quantity: 4 }),
      hoverAttract({ distance: 180, duration: 0.5 })
    ),
  }),
  overlay: makeOverlay(overlaySvg, ramadanLanternAnimate, "top-right"),
  accessibility: { reducedMotionFallback: "accent-only" },
};
export default theme;
