/**
 * "Replay intro": playing a page's intro again after the first visit. Browser
 * only. The head script (INTRO_BOOT_SCRIPT in ./intro) installed Skip, Escape
 * and the end of the animation for every play, so this only starts one.
 */

import { isSaveData } from "@/lib/holiday/save-data";
import {
  INTRO_ATTR,
  INTRO_RUN_ATTR,
  OVERLAY_ATTR,
  RETURN_ATTR,
  SKIP_ATTR,
  introSafetyMs,
  type IntroKind,
} from "./intro";

/** Reduced motion and Save-Data never get an intro, replayed or not. */
export function introAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return !isSaveData();
}

/**
 * End whatever intro is playing, and give focus back to what started it (as the
 * head script's own stop does), or to the page after an arrival.
 */
export function stopIntro(): void {
  const root = document.documentElement;
  if (!root.hasAttribute(INTRO_ATTR)) return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.closest(`[${OVERLAY_ATTR}]`)) focused.blur();
  root.removeAttribute(INTRO_ATTR);
  const opener = document.querySelector<HTMLElement>(`[${RETURN_ATTR}]`);
  if (opener) {
    opener.removeAttribute(RETURN_ATTR);
    opener.focus({ preventScroll: true });
  }
}

let runs = 0;

/**
 * Play `kind`'s intro from the start. Returns false, and plays nothing, if this
 * page has no such overlay or motion has been turned down since it loaded. Its
 * run is a new number, so the arrival's ("0") safety timer can't end it.
 */
export function playIntro(kind: IntroKind): boolean {
  const overlay = document.querySelector<HTMLElement>(`[${OVERLAY_ATTR}="${kind}"]`);
  if (!overlay || !introAllowed()) return false;
  const root = document.documentElement;
  root.removeAttribute(INTRO_ATTR);
  document.querySelector(`[${RETURN_ATTR}]`)?.removeAttribute(RETURN_ATTR);
  const opener = document.activeElement;
  if (
    opener instanceof HTMLElement &&
    opener !== document.body &&
    !opener.closest(`[${OVERLAY_ATTR}]`)
  ) {
    opener.setAttribute(RETURN_ATTR, "");
  }
  // Hidden and measured, so showing it again starts every animation afresh.
  void overlay.offsetWidth;
  const run = String(++runs);
  root.setAttribute(INTRO_RUN_ATTR, run);
  root.setAttribute(INTRO_ATTR, kind);
  overlay.querySelector<HTMLElement>(`[${SKIP_ATTR}]`)?.focus({ preventScroll: true });
  window.setTimeout(() => {
    if (root.getAttribute(INTRO_RUN_ATTR) === run) stopIntro();
  }, introSafetyMs(kind));
  return true;
}
