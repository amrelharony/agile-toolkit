import type { ISourceOptions } from "@tsparticles/engine";
import type { HolidayOverlay, HolidayOverlayContext } from "../types";

/**
 * Shared tsparticles config builder. Every holiday theme composes this base,
 * then overrides colors/shapes/movement to get its signature feel.
 */
export function baseParticleConfig(overrides: Partial<ISourceOptions> = {}): ISourceOptions {
  return {
    fullScreen: { enable: false },
    background: { color: "transparent" },
    detectRetina: true,
    fpsLimit: 30,
    pauseOnOutsideViewport: true,
    pauseOnBlur: true,
    particles: {
      number: { value: 40, density: { enable: true } },
      color: { value: "#ffffff" },
      opacity: { value: { min: 0.3, max: 0.8 } },
      size: { value: { min: 2, max: 4 } },
      move: { enable: true, speed: 1, direction: "none", outModes: { default: "out" } },
      shape: { type: "circle" },
    },
    ...overrides,
  };
}

export function accentTokens(primary: string, secondary: string, glow: string) {
  return {
    "--holiday-accent": primary,
    "--holiday-accent-2": secondary,
    "--holiday-glow": glow,
  };
}

// ---------------------------------------------------------------------------
// Interactivity builders
// ---------------------------------------------------------------------------

export interface ClickBurstOptions {
  /** How many particles to push on each click. Default 6. */
  quantity?: number;
}

/** Click anywhere → push N particles. tsparticles auto-positions at click. */
export function clickBurst({ quantity = 6 }: ClickBurstOptions = {}) {
  return {
    events: { onClick: { enable: true, mode: "push" } },
    modes: { push: { quantity } },
  };
}

export interface HoverOptions {
  /** Pixels around cursor that react. Default 140. */
  distance?: number;
  /** Reaction strength (seconds). Default 0.4. */
  duration?: number;
}

/** Hover → particles flee the cursor. */
export function hoverRepel({ distance = 140, duration = 0.4 }: HoverOptions = {}) {
  return {
    events: { onHover: { enable: true, mode: "repulse" } },
    modes: { repulse: { distance, duration } },
  };
}

/** Hover → particles drift toward the cursor. */
export function hoverAttract({ distance = 200, duration = 0.6 }: HoverOptions = {}) {
  return {
    events: { onHover: { enable: true, mode: "attract" } },
    modes: { attract: { distance, duration, factor: 1 } },
  };
}

/** Hover → leave a tsparticles trail of accent specks. */
export function hoverTrail(color: string, quantity = 1) {
  return {
    events: { onHover: { enable: true, mode: "trail" } },
    modes: { trail: { delay: 0.05, quantity, particles: { color: { value: color } } } },
  };
}

/** Combine multiple event blocks ({ events, modes }) into one. */
export function combineInteractivity(
  ...blocks: Array<{ events?: object; modes?: object } | undefined>
): { events: object; modes: object } {
  const events: Record<string, unknown> = {};
  const modes: Record<string, unknown> = {};
  for (const b of blocks) {
    if (!b) continue;
    Object.assign(events, b.events ?? {});
    Object.assign(modes, b.modes ?? {});
  }
  return { events, modes };
}

// ---------------------------------------------------------------------------
// Constellation links — used by Hijri New Year, Eid al-Adha, Mawlid
// ---------------------------------------------------------------------------

export function constellationLinks(color: string, opacity = 0.18, distance = 120) {
  return {
    enable: true,
    color,
    distance,
    opacity,
    width: 1,
    triangles: { enable: false },
  };
}

// ---------------------------------------------------------------------------
// Reusable SVG fragments
// ---------------------------------------------------------------------------

/** Egyptian flag SVG with optional Arabic caption below. Used by all
 *  Egyptian national-day themes. The flag itself is the recognizable
 *  signature; the Arabic caption disambiguates which holiday it is, so a
 *  visitor opening the page on Jan 25 immediately understands the context.
 *  The eagle on the white stripe is heavily simplified to a single readable
 *  silhouette at small sizes. */
export function egyptianFlag(
  opts: {
    width?: number;
    eagle?: boolean;
    captionAr?: string;
    captionEn?: string;
  } = {}
): string {
  const w = opts.width ?? 280;
  const flagH = Math.round(w * 0.6);
  const hasCaption = !!(opts.captionAr || opts.captionEn);
  const totalH = flagH + (hasCaption ? 50 : 0);
  const eagle = opts.eagle ?? true;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${hasCaption ? 78 : 60}" width="${w}" height="${totalH}" data-holiday-svg="egypt-flag" style="overflow:visible;filter:drop-shadow(0 8px 18px rgba(0,0,0,0.4));">
    <defs>
      <linearGradient id="egflag-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
        <stop offset="50%" stop-color="rgba(255,255,255,0)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.18)"/>
      </linearGradient>
    </defs>
    <g data-holiday-flag>
      <rect x="0" y="0"  width="100" height="20" fill="#ce1126"/>
      <rect x="0" y="20" width="100" height="20" fill="#ffffff"/>
      <rect x="0" y="40" width="100" height="20" fill="#000000"/>
      ${
        eagle
          ? `
      <g transform="translate(43 22) scale(0.9)" fill="#cca644">
        <path d="M7 0 L9 5 L14 6 L10 9 L11 14 L7 11 L3 14 L4 9 L0 6 L5 5 Z"/>
        <rect x="6" y="11" width="2" height="6"/>
      </g>`
          : ""
      }
      <rect x="0" y="0" width="100" height="60" fill="url(#egflag-shade)" opacity="0.7"/>
    </g>
    ${
      opts.captionAr
        ? `<text data-holiday-caption-ar x="50" y="70" text-anchor="middle"
            font-family="'Amiri','Scheherazade New','Noto Naskh Arabic',Georgia,serif"
            font-size="7" font-weight="700" fill="#fcd116" direction="rtl">${opts.captionAr}</text>`
        : ""
    }
    ${
      opts.captionEn
        ? `<text data-holiday-caption-en x="50" y="76" text-anchor="middle"
            font-family="'Inter',sans-serif"
            font-size="3" font-weight="500" fill="#ffffff" opacity="0.7" letter-spacing="2">${opts.captionEn}</text>`
        : ""
    }
  </svg>`;
}

/** Glowing crescent moon + star — Ramadan / Eid al-Adha / Hijri New Year.
 *
 *  Implementation note: the previous version used a two-arc path
 *  `A 38 38 ... A 28 28 ...` that shared its endpoints across the 76-unit
 *  chord. Per SVG spec, an arc whose radius is too small for the requested
 *  chord is auto-scaled up — so the inner radius-28 arc was rescaled to
 *  match the outer radius-38 arc, collapsing the path into a degenerate
 *  shape (no recognizable crescent rendered). Rebuilt with a mask-based
 *  approach: draw a full moon disc and subtract an offset disc via a mask.
 *  Guaranteed crescent geometry. Unique mask ID per call so multiple
 *  themes loaded in sequence can't collide.
 */
let crescentSeq = 0;
export function crescentMoonStar(
  opts: {
    width?: number;
    moonColor?: string;
    starColor?: string;
    glowColor?: string;
  } = {}
): string {
  const w = opts.width ?? 200;
  const moon = opts.moonColor ?? "#fde68a";
  const star = opts.starColor ?? "#fef3c7";
  const glow = opts.glowColor ?? "rgba(245, 158, 11, 0.55)";
  const id = ++crescentSeq;
  const maskId = `crescent-mask-${id}`;
  const glowId = `crescent-glow-${id}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${w}" height="${w}" data-holiday-svg="crescent" style="overflow:visible;">
    <defs>
      <radialGradient id="${glowId}" cx="45%" cy="50%" r="55%">
        <stop offset="0%" stop-color="${glow}"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
      <mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
        <rect x="0" y="0" width="120" height="120" fill="white"/>
        <!-- Offset disc subtracts the right portion of the full moon, leaving a crescent opening to the right -->
        <circle cx="68" cy="60" r="32" fill="black"/>
      </mask>
    </defs>
    <!-- Soft green/gold halo behind the moon -->
    <circle data-holiday-glow cx="50" cy="60" r="56" fill="url(#${glowId})"/>
    <!-- Full disc, masked into a crescent -->
    <circle data-holiday-moon cx="50" cy="60" r="38" fill="${moon}" mask="url(#${maskId})"/>
    <!-- 5-point accent star to the upper right -->
    <g data-holiday-star transform="translate(95 32)">
      <polygon points="0,-11 3.2,-3.3 11,-3.3 4.7,1.8 7,9.5 0,5 -7,9.5 -4.7,1.8 -11,-3.3 -3.2,-3.3" fill="${star}"/>
    </g>
  </svg>`;
}

/** Cleanup helper — kill all tweens/timelines registered against `target`. */
export function killGsapOf(ctx: HolidayOverlayContext, ...targets: unknown[]) {
  for (const t of targets) {
    try {
      ctx.gsap.killTweensOf(t as object);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Reusable GSAP timelines
// ---------------------------------------------------------------------------

/** A flag-wave timeline — subtle skewY/scaleX oscillation. Used by all the
 *  Egyptian revolution-day themes. Returns a cleanup. */
export function wavingFlagAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const flag = svg.querySelector<SVGGElement>("[data-holiday-flag]");
  if (!flag) return () => {};
  // Lock visible — same defensive pattern as pulseGlowAnimate.
  ctx.gsap.set(svg, { opacity: 1 });
  ctx.gsap.set(flag, { transformOrigin: "0% 50%" });
  const tl = ctx.gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
  tl.to(flag, { skewY: 2.5 * ctx.windMultiplier, scaleX: 1.02, duration: 1.8 })
    .to(flag, { skewY: -1.5 * ctx.windMultiplier, scaleX: 0.99, duration: 1.6 })
    .to(flag, { skewY: 0, scaleX: 1, duration: 1.4 });
  // Subtle entrance — fromTo with explicit end state so a killed-mid-tween
  // can't strand the SVG at opacity 0 or y -12.
  ctx.gsap.fromTo(
    svg,
    { opacity: 0, y: -12 },
    { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }
  );
  return () => {
    tl.kill();
    ctx.gsap.killTweensOf(flag);
    ctx.gsap.killTweensOf(svg);
  };
}

/** A pulsing-glow timeline — used by Ramadan/Eid crescent moon and similar
 *  signature pieces. */
export function pulseGlowAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const glow = svg.querySelector<SVGCircleElement>("[data-holiday-glow]");
  const star = svg.querySelector<SVGGElement>("[data-holiday-star]");
  const moon = svg.querySelector<SVGCircleElement>("[data-holiday-moon]");

  // Lock the SVG fully visible up front — defensive against React StrictMode
  // double-mounting an effect where the cleanup runs before a `gsap.from`
  // tween finishes, which would otherwise strand the element at opacity 0.
  ctx.gsap.set(svg, { opacity: 1 });

  const tl = ctx.gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
  if (glow) {
    tl.fromTo(
      glow,
      { opacity: 0.6, scale: 0.9, transformOrigin: "50px 60px" },
      { opacity: 1, scale: 1.18, duration: 2.4 },
      0
    );
  }
  if (star) {
    ctx.gsap.set(star, { transformOrigin: "95px 32px" });
    ctx.gsap.to(star, {
      rotation: 360,
      duration: 14,
      repeat: -1,
      ease: "none",
    });
    tl.to(star, { scale: 1.25, duration: 1.6 }, 0.4);
  }
  if (moon) {
    // fromTo with explicit end state — `from` alone reads the current opacity
    // as the end state, which fails if a previous run killed mid-tween.
    ctx.gsap.fromTo(
      moon,
      { opacity: 0, y: -20 },
      { opacity: 1, y: 0, duration: 1, ease: "power2.out" }
    );
  }
  // SVG entrance — explicit end state, see comment above.
  ctx.gsap.fromTo(svg, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: "power2.out" });
  return () => {
    tl.kill();
    if (star) ctx.gsap.killTweensOf(star);
    if (moon) ctx.gsap.killTweensOf(moon);
    ctx.gsap.killTweensOf(svg);
  };
}

/** Polygon-path generator config — used by themes that want particles to
 *  meander instead of moving in a straight line. Requires loadPolygonPath
 *  to be registered (engine.tsx initParticles does this). */
export function polygonPath(
  opts: { sides?: number; turnSteps?: number; angle?: number; delay?: number } = {}
) {
  return {
    enable: true,
    generator: "polygonPathGenerator",
    delay: { value: opts.delay ?? 0.1 },
    options: {
      sides: opts.sides ?? 6,
      turnSteps: opts.turnSteps ?? 30,
      angle: opts.angle ?? 30,
    },
  };
}

/** Build an SVG overlay that's a static accented quote/text — used by Eid
 *  (Eid Mubarak), Mother's Day, etc. */
export function textOverlay(opts: {
  primary: string;
  glow: string;
  topLine: string;
  bottomLine?: string;
  width?: number;
}): string {
  const w = opts.width ?? 280;
  const h = opts.bottomLine ? 110 : 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-holiday-svg="text-banner" style="filter:drop-shadow(0 0 20px ${opts.glow});">
    <text data-holiday-text-1 x="50%" y="${opts.bottomLine ? "42%" : "62%"}" text-anchor="middle" font-family="'Source Serif 4', Georgia, serif" font-size="32" font-weight="700" fill="${opts.primary}" letter-spacing="2">${opts.topLine}</text>
    ${opts.bottomLine ? `<text data-holiday-text-2 x="50%" y="78%" text-anchor="middle" font-family="'Inter', sans-serif" font-size="14" font-weight="400" fill="${opts.primary}" opacity="0.7" letter-spacing="6">${opts.bottomLine}</text>` : ""}
  </svg>`;
}

/** Reusable entrance animation for text banners: top-line draws in via
 *  letter-stagger-like clipPath, bottom-line fades in. */
export function textBannerAnimate(svg: SVGSVGElement, ctx: HolidayOverlayContext): () => void {
  const top = svg.querySelector<SVGTextElement>("[data-holiday-text-1]");
  const bottom = svg.querySelector<SVGTextElement>("[data-holiday-text-2]");
  const tl = ctx.gsap.timeline();
  if (top) {
    tl.from(top, { opacity: 0, y: 14, duration: 0.9, ease: "power3.out" });
    tl.to(
      top,
      {
        // breathing glow via filter intensity proxy: scale very subtly
        scale: 1.04,
        transformOrigin: "50% 50%",
        repeat: -1,
        yoyo: true,
        duration: 2.4,
        ease: "sine.inOut",
      },
      0.9
    );
  }
  if (bottom) {
    tl.from(bottom, { opacity: 0, y: 10, duration: 0.7, ease: "power2.out" }, 0.3);
  }
  return () => {
    tl.kill();
    if (top) ctx.gsap.killTweensOf(top);
    if (bottom) ctx.gsap.killTweensOf(bottom);
  };
}

// Convenience export — themes spread this into `overlay`
export function makeOverlay(
  svg: string,
  animate?: HolidayOverlay["animate"],
  position?: HolidayOverlay["position"],
  className?: string
): HolidayOverlay {
  return { svg, animate, position, className };
}
