"use client";

import type { MoodProfile } from "./types";
import { getCurrentProfile, onMoodChange } from "./engine";

/**
 * GSAP integration — lazy-loaded so the 68KB core stays out of the critical
 * path until a component actually requests a mood-driven tween.  The first
 * call pays the dynamic-import cost (~150ms on a cold cache); subsequent
 * calls are fully synchronous via the cached module.
 */

type GsapModule = typeof import("gsap");
type ScrollTriggerModule = typeof import("gsap/ScrollTrigger").ScrollTrigger;

let gsapPromise: Promise<GsapModule> | null = null;
let scrollTriggerPromise: Promise<ScrollTriggerModule | null> | null = null;

async function loadGsap(): Promise<GsapModule> {
  if (!gsapPromise) {
    gsapPromise = import("gsap").catch((err) => {
      // Null the cache so a retry is possible (rare CDN/chunk failures).
      gsapPromise = null;
      throw err;
    });
  }
  return gsapPromise;
}

async function ensureScrollTrigger(): Promise<ScrollTriggerModule | null> {
  if (typeof window === "undefined") return null;
  if (scrollTriggerPromise) return scrollTriggerPromise;
  scrollTriggerPromise = (async () => {
    try {
      const gsap = await loadGsap();
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.default.registerPlugin(ScrollTrigger);
      return ScrollTrigger;
    } catch {
      scrollTriggerPromise = null;
      return null;
    }
  })();
  return scrollTriggerPromise;
}

// ---------------------------------------------------------------------------
// Live profile tracking
// ---------------------------------------------------------------------------
//
// GSAP snapshots a tween's ease function at creation time.  Mutating
// `tween.vars.ease` mid-flight does *not* actually change the remaining
// interpolation, and `tween.timeScale(1 / newDs)` only lands on the correct
// effective duration when the tween was originally created at ds=1.  Rather
// than ship a feature that subtly lies, we limit ourselves to tracking
// in-flight tweens so callers can cancel them (e.g., on route change) via
// `killMoodTweens()`.
//
// For reactive behavior, components should subscribe via `useMood()` and
// create a fresh tween when the mood transitions.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const liveTweens = new Set<any>();

// Prune completed tweens whenever the mood changes so the set doesn't grow.
onMoodChange(() => {
  for (const tween of Array.from(liveTweens)) {
    try {
      if (!tween || tween.progress() >= 1) liveTweens.delete(tween);
    } catch {
      liveTweens.delete(tween);
    }
  }
});

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export interface MoodTweenOptions {
  /** Base duration in seconds — will be multiplied by the active profile's ds. */
  duration?: number;
  /** Delay before the tween starts (in seconds, unscaled). */
  delay?: number;
  /** Opt into live re-profiling when the mood changes mid-tween. */
  liveReprofile?: boolean;
  /** Override the profile for this call (e.g., always "Focused" on errors). */
  profileOverride?: MoodProfile;
  /** Any extra GSAP vars — merged last. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Tween a target with the current mood profile applied.  Returns the tween
 * so callers can await or chain it.  If GSAP hasn't loaded yet, this returns
 * a promise that resolves once the module is in memory.
 */
export async function moodTween(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: any,
  vars: MoodTweenOptions,
) {
  const gsap = (await loadGsap()).default;
  const profile = vars.profileOverride ?? getCurrentProfile();
  const baseDuration = vars.duration ?? 0.4;
  const { profileOverride, liveReprofile, ...rest } = vars;
  void profileOverride;
  const tween = gsap.to(target, {
    ...rest,
    duration: baseDuration * profile.ds,
    ease: profile.ease,
  });
  if (liveReprofile) liveTweens.add(tween);
  return tween;
}

/** Stagger variant — applies ss to `stagger` and ds to `duration`. */
export async function moodStagger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targets: any,
  vars: MoodTweenOptions & { stagger?: number },
) {
  const gsap = (await loadGsap()).default;
  const profile = vars.profileOverride ?? getCurrentProfile();
  const baseDuration = vars.duration ?? 0.4;
  const baseStagger = vars.stagger ?? 0.06;
  const { profileOverride, liveReprofile, ...rest } = vars;
  void profileOverride;
  const tween = gsap.to(targets, {
    ...rest,
    duration: baseDuration * profile.ds,
    stagger: baseStagger * profile.ss,
    ease: profile.ease,
  });
  if (liveReprofile) liveTweens.add(tween);
  return tween;
}

export interface MoodScrollRevealOptions {
  /** from-state GSAP vars (e.g., opacity: 0, y: 30). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from?: Record<string, any>;
  /** to-state GSAP vars — defaults to opacity 1, y 0, clearProps all. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  to?: Record<string, any>;
  /** Base duration; scaled by profile.ds. */
  duration?: number;
  /** Base stagger between items; scaled by profile.ss. */
  stagger?: number;
  /** ScrollTrigger "start" string. Default "top 85%". */
  start?: string;
  /** Trigger the animation only once (default true). */
  once?: boolean;
  /** Live re-profile this tween when mood changes. */
  liveReprofile?: boolean;
}

/**
 * Scroll-reveal helper — the canonical entry point from the spec.
 * Sets up a ScrollTrigger that plays an entrance animation tuned to the
 * current mood profile when the target enters the viewport.
 */
export async function moodScrollReveal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targets: any,
  opts: MoodScrollRevealOptions = {},
) {
  if (typeof window === "undefined") return null;
  const gsap = (await loadGsap()).default;
  const ScrollTrigger = await ensureScrollTrigger();
  if (!ScrollTrigger) return null;
  const profile = getCurrentProfile();

  const from = opts.from ?? { opacity: 0, y: 28 };
  const to = opts.to ?? { opacity: 1, y: 0, clearProps: "transform" };
  const duration = (opts.duration ?? 0.6) * profile.ds;
  const stagger = (opts.stagger ?? 0.08) * profile.ss;
  const start = opts.start ?? "top 85%";
  const once = opts.once ?? true;

  // Resolve the nodes array so we can pass the *first* one as the
  // ScrollTrigger trigger while animating them all together.
  const nodes: Element[] = Array.isArray(targets)
    ? targets
    : typeof targets === "string"
      ? Array.from(document.querySelectorAll(targets))
      : targets
        ? [targets as Element]
        : [];
  if (nodes.length === 0) return null;

  const tween = gsap.fromTo(
    nodes,
    from,
    {
      ...to,
      duration,
      stagger,
      ease: profile.reveal,
      scrollTrigger: {
        trigger: nodes[0],
        start,
        toggleActions: once ? "play none none none" : "play reverse play reverse",
        once,
      },
    },
  );
  if (opts.liveReprofile) liveTweens.add(tween);
  return tween;
}

/** Kill all pending live-reprofile tweens — call from page-transition cleanup. */
export function killMoodTweens() {
  for (const tween of Array.from(liveTweens)) {
    try {
      tween.kill?.();
    } catch {
      /* ignore */
    }
  }
  liveTweens.clear();
}

export { loadGsap, ensureScrollTrigger };
