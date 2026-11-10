"use client";

import { useEffect } from "react";
import { INTRO_ATTR, INTRO_END_EVENT, OVERLAY_ATTR, type IntroKind } from "@/lib/comics/intro";
import { stopIntro } from "@/lib/comics/play-intro";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const INERT = "inert";

/**
 * While its intro plays, the page behind the overlay can't be reached: every
 * sibling along the overlay's chain of ancestors, up to <body>, is inert, so
 * neither Tab nor a screen reader's cursor can wander under the overlay. The
 * head script only holds Tab on Skip, which is all there is before this loads.
 *
 * What mounts mid-intro is held too: the app shell loads Amr's launcher and
 * the holiday engine after hydration, beside the overlay's ancestors, and a
 * portal can open in <body>. So the chain's parents are watched for new
 * children while the intro plays.
 *
 * Each sibling keeps its owner's word for the end. Anything already inert (a
 * closed drawer) stays so, and only what this set is released, as in
 * hooks/use-inert-siblings. If an owner sets or removes its own inert while
 * the intro plays (the sidebar does, when a tablet turns past 768 px), the
 * page stays held until the end, and then each sibling is left as its owner
 * last asked.
 *
 * Release is at once, on INTRO_END_EVENT, which both ways an intro ends
 * dispatch before they focus the opener; an inert opener would refuse that
 * focus. Watching <html> for the attribute is the backstop, and how a replay
 * is noticed.
 *
 * If motion is turned down mid-intro, globals.css hides the overlay; the intro
 * is then ended here, so the page isn't left inert under nothing.
 *
 * Rendered by IntroOverlay; draws nothing.
 */
export function IntroInert({ kind }: { kind: IntroKind }) {
  useEffect(() => {
    const root = document.documentElement;
    /** While held: each sibling along the chain, and whether its owner wants it inert. */
    let wanted: Map<Element, boolean> | null = null;
    /** The overlay and its ancestors, which stay reachable. */
    let chain = new Set<Element>();

    const playing = () => root.getAttribute(INTRO_ATTR) === kind;

    // New children of the chain's parents, and each held sibling's inert.
    const watch = new MutationObserver(onChange);

    /** Hold one sibling: note its owner's word, make it inert, and listen for that owner. */
    function track(el: Element) {
      if (!wanted || wanted.has(el) || chain.has(el)) return;
      const inert = el.hasAttribute(INERT);
      wanted.set(el, inert);
      // Written before it is watched, so this write is never read as its owner's.
      if (!inert) el.setAttribute(INERT, "");
      watch.observe(el, { attributes: true, attributeFilter: [INERT] });
    }

    function onChange(records: MutationRecord[]) {
      const held = wanted;
      if (!held) return;
      const touched = new Set<Element>();
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element) track(node);
          }
        } else if (record.target instanceof Element) touched.add(record.target);
      }
      // Once each, from its state now: an owner's last write is its word.
      touched.forEach((el) => {
        if (!held.has(el)) return;
        const inert = el.hasAttribute(INERT);
        held.set(el, inert);
        if (!inert) el.setAttribute(INERT, "");
      });
      // The writes just made here are this guard's, not an owner's.
      watch.takeRecords();
    }

    function release() {
      if (!wanted) return;
      onChange(watch.takeRecords());
      watch.disconnect();
      wanted.forEach((inert, el) => {
        if (!inert) el.removeAttribute(INERT);
      });
      wanted = null;
      chain = new Set();
    }

    function hold() {
      if (wanted) return;
      const overlay = document.querySelector<HTMLElement>(`[${OVERLAY_ATTR}="${kind}"]`);
      if (!overlay || getComputedStyle(overlay).display === "none") return;
      const parents: Element[] = [];
      chain = new Set([overlay]);
      for (let node: Element = overlay; node !== document.body; ) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        parents.push(parent);
        chain.add(parent);
        node = parent;
      }
      wanted = new Map();
      for (const parent of parents) {
        watch.observe(parent, { childList: true });
        for (const child of Array.from(parent.children)) track(child);
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
