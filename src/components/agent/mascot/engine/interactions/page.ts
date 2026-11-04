/**
 * What Amr notices on the page (docs/mascot/AMR-ART-BRIEF.md, Appendix A): a fast
 * scroll blows him about, reaching the end of the page he points back up, he
 * watches the visitor type (desktop), copying text gets a thumbs-up, a sent form
 * a fist pump, going offline and back a sad face and a cheer, coming back after
 * a while a wave, and the pointer leaving the window a game of peekaboo.
 *
 * None of these were asked for, so each goes through the director's restraint.
 * The detectors are pure and exported for tests; installPageSenses wires them up.
 */

import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";

export interface PageHooks {
  act(r: MascotReaction): void;
  hold(h: MascotHold, on: boolean): void;
  allow(name: string, cooldownMs?: number, urgent?: boolean): boolean;
  /** Phones step aside for the keyboard, so he doesn't watch typing there. */
  isPhone(): boolean;
  /** The assistant panel is open. */
  isOpen(): boolean;
  /** Where he's parked: he points up at the end of the page only from the bottom. */
  parkedTop(): boolean;
  reducedMotion: boolean;
  now?: () => number;
}

/** Faster than this (px/s) is a fast scroll. */
export const WIND_SPEED = 2500;
/** The wind dies down after this long without a fast scroll. */
const WIND_HOLD_MS = 350;
/** Typing: he keeps watching for this long after the last keystroke. */
const WATCH_HOLD_MS = 2500;
/** Away this long, he waves when the visitor comes back. */
export const AWAY_MS = 2 * 60_000;
/** The pointer has to stay out this long before he hides his eyes. */
const PEEK_DELAY_MS = 350;

/** Tracks scroll speed (px/s), smoothed so one jumpy event isn't a gust. */
export function createScrollSpeed() {
  let lastY: number | null = null;
  let lastT = 0;
  let speed = 0;
  return {
    sample(y: number, t: number): number {
      if (lastY === null || t - lastT > 1000) {
        lastY = y;
        lastT = t;
        speed = 0;
        return 0;
      }
      const dt = Math.max(t - lastT, 8);
      const v = (Math.abs(y - lastY) / dt) * 1000;
      speed = speed * 0.5 + v * 0.5;
      lastY = y;
      lastT = t;
      return speed;
    },
  };
}

/** True when the page is long enough to scroll and the visitor is at its end. */
export function atPageEnd(scrollY: number, viewH: number, docH: number): boolean {
  return docH > viewH * 1.6 && scrollY + viewH >= docH - 8;
}

function isField(t: EventTarget | null): t is HTMLElement {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(type);
}

const inPanel = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("[data-agent-sheet-root]");

export function installPageSenses(hooks: PageHooks): () => void {
  const now = hooks.now ?? (() => Date.now());
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id: ReturnType<typeof setTimeout> | undefined) => {
    if (id === undefined) return;
    clearTimeout(id);
    timers.delete(id);
  };

  // Fast scroll → wind, until it settles. The end of a long page → point back up.
  const scroll = createScrollSpeed();
  let windOn = false;
  let windTimer: ReturnType<typeof setTimeout> | undefined;
  let endedOn: string | null = null;
  let scrolledDown = false;
  let lastScrollY = typeof window === "undefined" ? 0 : window.scrollY;
  const windOff = () => {
    windOn = false;
    hooks.hold("wind", false);
  };
  const onScroll = () => {
    const y = window.scrollY;
    if (y > lastScrollY) scrolledDown = true;
    lastScrollY = y;
    const v = scroll.sample(y, now());
    if (!hooks.reducedMotion) {
      if (!windOn && v > WIND_SPEED && hooks.allow("wind", 20_000)) {
        windOn = true;
        hooks.hold("wind", true);
      }
      if (windOn && v > WIND_SPEED / 2) {
        cancel(windTimer);
        windTimer = later(windOff, WIND_HOLD_MS);
      }
    }
    const path = window.location.pathname;
    if (
      scrolledDown &&
      endedOn !== path &&
      !hooks.parkedTop() &&
      atPageEnd(y, window.innerHeight, document.documentElement.scrollHeight)
    ) {
      endedOn = path;
      if (hooks.allow("pointUp", 2 * 60_000)) later(() => hooks.act("pointUp"), 400);
    }
  };

  // Typing in a field on the page (not in his panel), desktop only → watching.
  let watching = false;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  const watchOff = () => {
    if (!watching) return;
    watching = false;
    hooks.hold("watching", false);
  };
  const onInput = (e: Event) => {
    if (hooks.isPhone() || !isField(e.target) || inPanel(e.target)) return;
    if (!watching && hooks.allow("watching", 45_000)) {
      watching = true;
      hooks.hold("watching", true);
    }
    if (watching) {
      cancel(watchTimer);
      watchTimer = later(watchOff, WATCH_HOLD_MS);
    }
  };
  const onFocusOut = (e: FocusEvent) => {
    if (isField(e.target)) {
      cancel(watchTimer);
      watchOff();
    }
  };

  const onCopy = () => {
    if (hooks.allow("thumbsUp", 30_000)) hooks.act("thumbsUp");
  };
  const onSubmit = (e: Event) => {
    if (inPanel(e.target)) return;
    if (hooks.allow("yes", 15_000)) hooks.act("yes");
  };
  const onOffline = () => {
    if (hooks.allow("downcast", 10_000, true)) hooks.act("downcast");
  };
  const onOnline = () => {
    if (hooks.allow("online", 10_000, true)) hooks.act("yes");
  };

  // Back after a while → a wave.
  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.hidden) {
      hiddenAt = now();
      return;
    }
    if (hiddenAt !== null && now() - hiddenAt > AWAY_MS && hooks.allow("wave", 60_000, true)) {
      hooks.act("wave");
    }
    hiddenAt = null;
  };

  // The pointer leaves the window and comes back → peekaboo (desktop).
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  let hiding = false;
  const onLeave = (e: MouseEvent) => {
    if (e.relatedTarget || hooks.isPhone() || hooks.isOpen()) return;
    cancel(peekTimer);
    peekTimer = later(() => {
      if (hooks.allow("peekaboo", 45_000)) {
        hiding = true;
        hooks.hold("peekHide", true);
      }
    }, PEEK_DELAY_MS);
  };
  const onEnter = () => {
    cancel(peekTimer);
    peekTimer = undefined;
    if (!hiding) return;
    hiding = false;
    hooks.hold("peekHide", false);
    hooks.act("peekFound");
  };

  const root = document.documentElement;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("input", onInput, true);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("copy", onCopy);
  document.addEventListener("submit", onSubmit, true);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  root.addEventListener("mouseleave", onLeave);
  root.addEventListener("mouseenter", onEnter);

  return () => {
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("copy", onCopy);
    document.removeEventListener("submit", onSubmit, true);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    root.removeEventListener("mouseleave", onLeave);
    root.removeEventListener("mouseenter", onEnter);
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    if (windOn) hooks.hold("wind", false);
    if (watching) hooks.hold("watching", false);
    if (hiding) hooks.hold("peekHide", false);
  };
}
