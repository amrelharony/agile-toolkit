"use client";

import { useEffect } from "react";
import {
  INTRO_ATTR,
  INTRO_END_EVENT,
  INTRO_KINDS,
  OVERLAY_ATTR,
  type IntroKind,
} from "@/lib/comics/intro";
import { stopIntro } from "@/lib/comics/play-intro";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const INERT = "inert";

/**
 * Elements a browser never draws, focuses or reads out, so inert would change
 * nothing for them. Next.js leaves its scripts in <body>: on /comics they were
 * 18 of the 34 siblings held, and every write makes the browser work out what
 * to restyle, so they're left alone.
 */
const NEVER_SHOWN = new Set(["script", "template", "style", "link", "meta", "noscript"]);

/** The page held for one intro. One plays at a time, so there's one hold at most. */
interface Hold {
  kind: IntroKind;
  /** Each sibling along the chain, and whether its owner wants it inert. */
  wanted: Map<Element, boolean>;
  /** The overlay and its ancestors, which stay reachable. */
  chain: Set<Element>;
  /** New children of the chain's parents, and each held sibling's inert. */
  watch: MutationObserver;
}

let held: Hold | null = null;

/** Hold one sibling: note its owner's word, make it inert, and listen for that owner. */
function track(hold: Hold, el: Element) {
  if (hold.wanted.has(el) || hold.chain.has(el) || NEVER_SHOWN.has(el.localName)) return;
  const inert = el.hasAttribute(INERT);
  hold.wanted.set(el, inert);
  // Written before it is watched, so this write is never read as its owner's.
  if (!inert) el.setAttribute(INERT, "");
  hold.watch.observe(el, { attributes: true, attributeFilter: [INERT] });
}

function onChange(hold: Hold, records: MutationRecord[]) {
  if (held !== hold) return;
  const touched = new Set<Element>();
  for (const record of records) {
    if (record.type === "childList") {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) track(hold, node);
      }
    } else if (record.target instanceof Element) touched.add(record.target);
  }
  // Once each, from its state now: an owner's last write is its word.
  touched.forEach((el) => {
    if (!hold.wanted.has(el)) return;
    const inert = el.hasAttribute(INERT);
    hold.wanted.set(el, inert);
    if (!inert) el.setAttribute(INERT, "");
  });
  // The writes just made here are this guard's, not an owner's.
  hold.watch.takeRecords();
}

/**
 * Make the page around `kind`'s overlay inert, if it is shown and not held
 * already. Held around another overlay (the app drew the page anew, as React
 * does after a hydration error), it is let go and held again around this one.
 */
function holdPage(kind: IntroKind) {
  const overlay = document.querySelector<HTMLElement>(`[${OVERLAY_ATTR}="${kind}"]`);
  if (held?.kind === kind && overlay && held.chain.has(overlay)) return;
  if (!overlay || getComputedStyle(overlay).display === "none") return;
  releasePage();
  const parents: Element[] = [];
  const chain = new Set<Element>([overlay]);
  for (let node: Element = overlay; node !== document.body; ) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    parents.push(parent);
    chain.add(parent);
    node = parent;
  }
  const next: Hold = {
    kind,
    wanted: new Map(),
    chain,
    watch: new MutationObserver((records) => onChange(next, records)),
  };
  held = next;
  for (const parent of parents) {
    next.watch.observe(parent, { childList: true });
    for (const child of Array.from(parent.children)) track(next, child);
  }
}

/** Let the page go: each sibling as its owner last asked. */
function releasePage() {
  const hold = held;
  if (!hold) return;
  onChange(hold, hold.watch.takeRecords());
  hold.watch.disconnect();
  held = null;
  hold.wanted.forEach((inert, el) => {
    if (!inert) el.removeAttribute(INERT);
  });
}

function releasePageOf(kind: IntroKind) {
  if (held?.kind === kind) releasePage();
}

/**
 * An arrival's intro is already playing when this file first runs (the head
 * script started it at the first paint), so its page is held from here,
 * before the app mounts. Held from inside the mount instead, every inert
 * write ran under the app's whole tree of effects, over 100 calls deep, and
 * a browser recording a trace (as Lighthouse does) copies that whole stack at
 * every write: on /comics that came to about 20 ms of the mount's longest
 * task. From here the stack is a few calls deep, and the restyle the writes
 * cause comes before the mount, not in it. IntroInert finds the page held and
 * keeps the hold. If the overlay isn't in the page yet, IntroInert holds it
 * when it mounts, as it does for a replay.
 *
 * Production only: React's development build reports any attribute it didn't
 * render on an element it hydrates, so in development the page is held when
 * IntroInert mounts. Exported for its test; nothing else calls it.
 */
export function holdOnLoad() {
  if (typeof document === "undefined" || process.env.NODE_ENV !== "production") return;
  // If the app never mounts, the end still lets the page go.
  document.addEventListener(INTRO_END_EVENT, releasePage);
  const kind = document.documentElement.getAttribute(INTRO_ATTR);
  const known = INTRO_KINDS.find((k) => k === kind);
  if (known) holdPage(known);
}

holdOnLoad();

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
 * An arrival's page is usually held already when this mounts (holdOnLoad).
 *
 * Rendered by IntroOverlay; draws nothing.
 */
export function IntroInert({ kind }: { kind: IntroKind }) {
  useEffect(() => {
    const root = document.documentElement;
    const playing = () => root.getAttribute(INTRO_ATTR) === kind;
    const sync = () => (playing() ? holdPage(kind) : releasePageOf(kind));
    const onEnd = () => releasePage();

    const motion = window.matchMedia?.(REDUCED_MOTION);
    const onMotion = () => {
      if (!motion?.matches || !playing()) return;
      stopIntro();
      releasePageOf(kind);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: [INTRO_ATTR] });
    document.addEventListener(INTRO_END_EVENT, onEnd);
    motion?.addEventListener?.("change", onMotion);
    return () => {
      observer.disconnect();
      document.removeEventListener(INTRO_END_EVENT, onEnd);
      motion?.removeEventListener?.("change", onMotion);
      releasePageOf(kind);
    };
  }, [kind]);

  return null;
}
