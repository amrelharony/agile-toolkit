/**
 * The header grow (DNA-SPEC section 8): when no view transition carried a
 * card's frame into the new page's header (Safari 17, a page that missed the
 * hold, a comic card, a card to a force-dynamic page, a related-tool tile),
 * the header grows out of the spot where the tapped card was.
 *
 * One Web Animations movement on the header, like Amr's own step slide: it
 * slides from the card's spot while a clip-path inset widens from the card's
 * size to its own, over DUR.travel on the glide easing (the frame's own), so
 * both ways in look alike. No fill: once it ends nothing is left on the
 * element, no inline style and no transform. The easing is a cubic-bezier,
 * which every engine with Web Animations takes; a linear() list would throw
 * where it is unknown (Safari 17.0-17.1).
 *
 * It never plays under reduced motion, Save-Data or 2G, while presenting or
 * with an intro on stage, and does nothing where element.animate is missing.
 *
 * The way back (slideBack): on Back, the card that opened the page slides
 * from where that page's header was into its own slot, by translate alone,
 * under the same rules (lib/motion/page-transition.ts decides when).
 */

import { isSaveData } from "@/lib/holiday/save-data";
import type { CardSpot } from "./page-transition";
import { isIntroOnStage } from "./stage";
// durations.ts, not tokens.ts: every tool page loads this, and tokens.ts
// brings the spring solver, which the grow never uses.
import { CURVE, DUR } from "./durations";

/**
 * Room the clip leaves around the header's own box once it is open, so the
 * panel's hard offset shadow (3px) is never cut while the header grows.
 */
const SHADOW_ROOM = 8;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/** Whether the header may grow now. */
export function canGrow(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.dataset.presenting === "true" || isIntroOnStage(root)) return false;
  return !prefersReducedMotion() && !isSaveData();
}

const px = (n: number) => `${Number(n.toFixed(1))}px`;

/**
 * Grow `element` from `spot` (viewport pixels). Call it once the element is
 * where it will be painted. Returns the animation, or null when it does not play.
 */
export function growFrom(element: HTMLElement, spot: CardSpot): Animation | null {
  if (typeof element.animate !== "function" || !canGrow()) return null;
  const to = element.getBoundingClientRect();
  if (to.width <= 0 || to.height <= 0 || spot.width <= 0 || spot.height <= 0) return null;
  // The header's corner starts on the card's, showing a card-sized piece of
  // itself; a card larger than the header shows all of it.
  const right = Math.max(0, to.width - spot.width);
  const bottom = Math.max(0, to.height - spot.height);
  const room = px(-SHADOW_ROOM);
  return element.animate(
    [
      {
        translate: `${px(spot.left - to.left)} ${px(spot.top - to.top)}`,
        clipPath: `inset(${room} ${px(right)} ${px(bottom)} ${room})`,
      },
      { translate: "0px 0px", clipPath: `inset(${room} ${room} ${room} ${room})` },
    ],
    { duration: DUR.travel, easing: CURVE.glide }
  );
}

/** How long a card takes to slide back into its slot on Back (0.3 s). */
export const RETURN_MS = 300;

/**
 * Slide `element` (a card back in its slot) from `from` (viewport pixels: the
 * header of the page Back left) to where it is. A translate only: the card
 * keeps its size and look and nothing fades; with no fill, nothing stays on
 * it once it ends. Where `translate` cannot be animated the card is simply in
 * its slot, as an instant Back leaves it. Returns the animation, or null when
 * it does not play.
 */
export function slideBack(
  element: HTMLElement,
  from: { left: number; top: number }
): Animation | null {
  if (typeof element.animate !== "function" || !canGrow()) return null;
  const at = element.getBoundingClientRect();
  const x = from.left - at.left;
  const y = from.top - at.top;
  // Already there: nothing to slide.
  if (Math.abs(x) < 1 && Math.abs(y) < 1) return null;
  return element.animate([{ translate: `${px(x)} ${px(y)}` }, { translate: "0px 0px" }], {
    duration: RETURN_MS,
    easing: CURVE.glide,
  });
}
