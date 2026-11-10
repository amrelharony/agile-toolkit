"use client";

import { useEffect } from "react";
import { INTRO_ATTR, INTRO_END_EVENT, OVERLAY_ATTR, type IntroKind } from "@/lib/comics/intro";
import { stopIntro } from "@/lib/comics/play-intro";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * While its intro plays, the page behind the overlay can't be reached: every
 * sibling along the overlay's chain of ancestors, up to <body>, is inert, so
 * neither Tab nor a screen reader's cursor can wander under the overlay. The
 * head script only holds Tab on Skip, which is all there is before this loads.
 *
 * Anything already inert (a closed drawer) is left alone, and only what this
 * set is released: the rule of hooks/use-inert-siblings. Release is at once, on
 * INTRO_END_EVENT, which both ways an intro ends dispatch before they focus the
 * opener; an inert opener would refuse that focus. Watching <html> for the
 * attribute is the backstop, and how a replay is noticed.
 *
 * If motion is turned down mid-intro, globals.css hides the overlay; the intro
 * is then ended here, so the page isn't left inert under nothing.
 *
 * Rendered by IntroOverlay; draws nothing.
 */
export function IntroInert({ kind }: { kind: IntroKind }) {
  useEffect(() => {
    const root = document.documentElement;
    let held: Element[] | null = null;

    const playing = () => root.getAttribute(INTRO_ATTR) === kind;

    function release() {
      for (const el of held ?? []) el.removeAttribute("inert");
      held = null;
    }

    function hold() {
      if (held) return;
      const overlay = document.querySelector<HTMLElement>(`[${OVERLAY_ATTR}="${kind}"]`);
      if (!overlay || getComputedStyle(overlay).display === "none") return;
      held = [];
      for (let node: Element = overlay; node !== document.body; ) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node || sibling.hasAttribute("inert")) continue;
          sibling.setAttribute("inert", "");
          held.push(sibling);
        }
        node = parent;
      }
    }

    const sync = () => (playing() ? hold() : release());

    const motion = window.matchMedia?.(REDUCED_MOTION);
    const onMotion = () => {
      if (!motion?.matches || !playing()) return;
      stopIntro();
      release();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: [INTRO_ATTR] });
    document.addEventListener(INTRO_END_EVENT, release);
    motion?.addEventListener?.("change", onMotion);
    return () => {
      observer.disconnect();
      document.removeEventListener(INTRO_END_EVENT, release);
      motion?.removeEventListener?.("change", onMotion);
      release();
    };
  }, [kind]);

  return null;
}
