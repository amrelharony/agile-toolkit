/**
 * What Amr gathers about how the visit is going, from signs anyone watching
 * would read:
 *
 *   • stuck: the same spot tapped again and again where nothing answers, or a
 *     form refusing what's typed into it, twice. He looks concerned and offers a
 *     hand, once per page per visit; tapping the offer opens his panel.
 *   • reading: the page scrolled steadily for a while. He keeps to himself (the
 *     director's gap grows, as it does while the visitor types).
 *   • a long stretch: 25 minutes of work without a pause. He stretches, and on
 *     Lively suggests the visitor might too; once an hour at most.
 *
 * Nothing here is recorded or sent: the signs are read, answered and forgotten.
 * The detectors are pure and exported for tests; installIntentSenses wires them.
 */

import type { MascotReaction } from "@/lib/agent/mascot/store";

/** Taps this close together (px)... */
const RAGE_RADIUS = 32;
/** ...this many of them... */
const RAGE_TAPS = 3;
/** ...within this long: nothing is answering. */
const RAGE_MS = 1500;

/** The same spot tapped again and again, where no control is. */
export function createRageTaps() {
  let taps: { x: number; y: number; t: number }[] = [];
  return {
    /** A tap that landed on something that isn't a control. True when it's the third. */
    sample(x: number, y: number, t: number): boolean {
      taps = taps.filter((p) => t - p.t <= RAGE_MS && Math.hypot(x - p.x, y - p.y) <= RAGE_RADIUS);
      taps.push({ x, y, t });
      if (taps.length < RAGE_TAPS) return false;
      taps = [];
      return true;
    },
    reset() {
      taps = [];
    },
  };
}

/** A form refusing its input this many times... */
const REFUSALS = 2;
/** ...within this long. */
const REFUSAL_MS = 20_000;

/** A form that keeps refusing what's put into it. */
export function createRefusals() {
  let at: number[] = [];
  return {
    sample(t: number): boolean {
      at = [...at.filter((x) => t - x <= REFUSAL_MS), t];
      if (at.length < REFUSALS) return false;
      at = [];
      return true;
    },
  };
}

/** Scrolled at a reading pace within this long: still reading. */
export const READING_MS = 4000;
/** Faster than this (px/s) is skimming or hunting, not reading. */
const READING_MAX_SPEED = 1400;
/** It takes this long of steady scrolling to count as reading. */
const READING_AFTER_MS = 3000;

/** Steady, unhurried scrolling: the visitor is reading. */
export function createReading() {
  let since: number | null = null;
  let last = -Infinity;
  let lastY: number | null = null;
  return {
    scroll(y: number, t: number): void {
      const dt = t - last;
      const speed = lastY === null || dt <= 0 ? 0 : (Math.abs(y - lastY) / dt) * 1000;
      if (dt > READING_MS || speed > READING_MAX_SPEED) since = null;
      if (since === null) since = t;
      last = t;
      lastY = y;
    },
    /** Whether they're reading now. */
    reading(t: number): boolean {
      return since !== null && t - last <= READING_MS && last - since >= READING_AFTER_MS;
    },
  };
}

/** Work without a pause this long earns a stretch. */
export const STRETCH_AFTER_MS = 25 * 60_000;
/** A gap this long in the visitor's input is a pause. */
const PAUSE_MS = 3 * 60_000;
/** At most one stretch this often. */
const STRETCH_EVERY_MS = 60 * 60_000;

/** A long stretch of work: input that keeps coming, with no real pause. */
export function createLongStretch() {
  let since: number | null = null;
  let last = -Infinity;
  let lastStretch = -Infinity;
  return {
    /** The visitor did something. True when it's time for a stretch. */
    input(t: number): boolean {
      if (since === null || t - last > PAUSE_MS) since = t;
      last = t;
      if (t - since < STRETCH_AFTER_MS || t - lastStretch < STRETCH_EVERY_MS) return false;
      lastStretch = t;
      since = t;
      return true;
    },
  };
}

export interface IntentHooks {
  act(r: MascotReaction): void;
  allow(name: string, cooldownMs?: number, urgent?: boolean): boolean;
  /** Someone's engaged with him already (his panel is open, he's being carried). */
  busy(): boolean;
  /** The page's path: he offers a hand once per page. */
  path(): string;
  /** Offer a hand (a bubble; tapping it opens his panel). False when he may not speak. */
  offerHelp(): boolean;
  /** Suggest a stretch (a bubble). */
  suggestStretch(): void;
  /** Whether a tap landed on a control (a button, a link, a field): those answer for themselves. */
  isControl(target: EventTarget | null): boolean;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  later?: (fn: () => void, ms: number) => unknown;
}

export interface IntentSenses {
  /** Whether the visitor is reading: he keeps to himself. */
  reading(): boolean;
  dispose(): void;
}

const HELPED_KEY = "mascot_helped";
/** He offers a hand this long after looking concerned. */
const OFFER_AFTER_MS = 1200;

function readHelped(storage: IntentHooks["storage"]): string[] {
  try {
    const raw = storage?.getItem(HELPED_KEY);
    if (!raw || raw.length > 4096) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function installIntentSenses(hooks: IntentHooks): IntentSenses {
  const now = hooks.now ?? (() => Date.now());
  const later = hooks.later ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const storage = hooks.storage === undefined ? safeSessionStorage() : hooks.storage;
  const rage = createRageTaps();
  const refusals = createRefusals();
  const reading = createReading();
  const stretch = createLongStretch();
  const timers: unknown[] = [];
  let disposed = false;

  /** He's seen someone stuck: a concerned look, then the offer. Once per page per visit. */
  const stuck = () => {
    if (hooks.busy()) return;
    const path = hooks.path();
    const helped = readHelped(storage);
    if (helped.includes(path) || !hooks.allow("stuck", 5 * 60_000, true)) return;
    try {
      storage?.setItem(HELPED_KEY, JSON.stringify([...helped, path].slice(-50)));
    } catch {
      /* he may offer again on this page */
    }
    hooks.act("concerned");
    timers.push(later(() => !disposed && hooks.offerHelp(), OFFER_AFTER_MS));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (hooks.isControl(e.target)) {
      rage.reset();
      return;
    }
    if (rage.sample(e.clientX, e.clientY, now())) stuck();
  };
  const onInvalid = () => {
    if (refusals.sample(now())) stuck();
  };
  const onScroll = () => reading.scroll(window.scrollY, now());
  const onInput = () => {
    if (!stretch.input(now()) || hooks.busy()) return;
    if (!hooks.allow("stretch", 10 * 60_000)) return;
    hooks.act("stretch");
    hooks.suggestStretch();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("invalid", onInvalid, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", onInput, { passive: true });
  window.addEventListener("pointerdown", onInput, { passive: true });

  return {
    reading: () => reading.reading(now()),
    dispose() {
      disposed = true;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("invalid", onInvalid, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
      timers.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    },
  };
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}
