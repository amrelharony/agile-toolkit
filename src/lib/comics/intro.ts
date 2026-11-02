/**
 * The three comic intros, and which one a page load plays.
 *
 * | Way in                          | Intro  | Length |
 * | ------------------------------- | ------ | ------ |
 * | /comics?ep=NN&b=NN (poster QR)  | poster | 3 s    |
 * | /comics (book cover, typed)     | book   | 5 s    |
 * | /vip, landing from the book QR  | vip    | 9 s    |
 *
 * Each plays once per device, from the first paint. INTRO_BOOT_SCRIPT runs in
 * <head> (app/layout.tsx inlines it beside the theme script), so it decides
 * before anything is drawn: it puts `data-intro="<kind>"` on <html>, and CSS
 * shows that page's overlay and runs its animation. No script has to load first,
 * which matters for someone scanning a poster on a slow phone.
 *
 * The script also handles Skip, Escape, keeping Tab on Skip, and the end of the
 * animation, for every play, including "Replay intro" (lib/comics/play-intro.ts).
 * A safety timer ends the intro if the animation never reports its end (a
 * background tab, a browser that doesn't run it). Reduced motion and Save-Data
 * get no intro at all, and globals.css hides the overlay for them too.
 *
 * Pure strings and constants: safe for the server layout and for the browser.
 */

import { VIP_HINT_COOKIE, VIP_HINT_VALUE, VIP_ROUTE } from "@/lib/vip/constants";
import { BOOK_EPISODE_COUNT, BUILDING_PATTERN, COMICS_ROUTE, EP_PATTERN } from "./entry";

export type IntroKind = "poster" | "book" | "vip";

export const INTRO_KINDS: readonly IntroKind[] = ["poster", "book", "vip"];

/** On <html> while an intro plays: its kind. */
export const INTRO_ATTR = "data-intro";
/** On <html>: which play this is, so an old safety timer can't end a replay. */
export const INTRO_RUN_ATTR = "data-intro-run";
/** On an intro's overlay: its kind. CSS shows it only when <html> has the same. */
export const OVERLAY_ATTR = "data-intro-overlay";
/** On the Skip button. */
export const SKIP_ATTR = "data-intro-skip";

/**
 * Under the `agile-toolkit:` prefix, so "Clear data on this browser" removes it
 * with the rest (lib/utils/clear-local-data), and the intro plays again.
 */
export const INTRO_MARK_PREFIX = "agile-toolkit:comics:intro:";

/** How long each intro runs, its exit included. Each scene's CSS ends by then. */
export const INTRO_SECONDS: Record<IntroKind, number> = { poster: 3, book: 5, vip: 9 };

/** How much later than INTRO_SECONDS the safety timer ends an intro. */
export const INTRO_SAFETY_MARGIN_SECONDS = 3;

export function introMarkKey(kind: IntroKind): string {
  return `${INTRO_MARK_PREFIX}${kind}`;
}

export function introSafetyMs(kind: IntroKind): number {
  return (INTRO_SECONDS[kind] + INTRO_SAFETY_MARGIN_SECONDS) * 1000;
}

/** The same rule as lib/holiday/save-data: Data Saver on, or a 2G connection. */
const SAVES_DATA = `(function(){var c=navigator.connection;return !!c&&(c.saveData===true||/2g/.test(c.effectiveType||""))})()`;
const REDUCED_MOTION = `window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches`;

const SAFETY_MS = JSON.stringify({
  poster: introSafetyMs("poster"),
  book: introSafetyMs("book"),
  vip: introSafetyMs("vip"),
});

/**
 * Which intro this address plays, mirroring the middleware: exactly /comics is
 * the book's; /comics with one valid book episode and one valid building is a
 * poster's (comicRewritePath's poster branch); /vip is the VIP intro when the
 * hint cookie says this device was unlocked. The server sends the VIP overlay
 * only to an unlocked device, so a forged hint shows nothing.
 */
const KIND_FOR_ADDRESS = `function(){var p=location.pathname,s=location.search;
if(p==="${COMICS_ROUTE}"){if(s==="")return"book";var q=new URLSearchParams(s),e=q.getAll("ep"),b=q.getAll("b");
if(e.length===1&&b.length===1&&/${EP_PATTERN.source}/.test(e[0])&&/${BUILDING_PATTERN.source}/.test(b[0])&&Number(e[0])<=${BOOK_EPISODE_COUNT})return"poster";return null}
if(p==="${VIP_ROUTE}"&&s===""){var c="";try{c=document.cookie}catch(x){}
if(c.split(";").some(function(v){return v.trim()==="${VIP_HINT_COOKIE}=${VIP_HINT_VALUE}"}))return"vip"}
return null}`;

/**
 * Blocking script for <head>. Its listeners go on every page, because a replay
 * can follow a client navigation, and they do nothing unless an intro plays.
 */
export const INTRO_BOOT_SCRIPT = `(function(){var d=document.documentElement,A="${INTRO_ATTR}",R="${INTRO_RUN_ATTR}";
function on(){return d.getAttribute(A)}
function skip(){var k=on();return k?document.querySelector('[${OVERLAY_ATTR}="'+k+'"] [${SKIP_ATTR}]'):null}
function stop(){if(!on())return;var f=document.activeElement;if(f&&f.closest&&f.closest("[${OVERLAY_ATTR}]"))f.blur();d.removeAttribute(A)}
document.addEventListener("click",function(e){var t=e.target;if(t&&t.closest&&t.closest("[${SKIP_ATTR}]"))stop()});
document.addEventListener("keydown",function(e){if(!on())return;if(e.key==="Escape")stop();else if(e.key==="Tab"){var s=skip();if(s){e.preventDefault();s.focus()}}});
document.addEventListener("animationend",function(e){var t=e.target,k=on();if(k&&t&&t.getAttribute&&t.getAttribute("${OVERLAY_ATTR}")===k)stop()});
try{var k=(${KIND_FOR_ADDRESS})();if(!k||${REDUCED_MOTION}||${SAVES_DATA})return;
var m="${INTRO_MARK_PREFIX}"+k;if(localStorage.getItem(m))return;localStorage.setItem(m,"1");
d.setAttribute(R,"0");d.setAttribute(A,k);
setTimeout(function(){if(d.getAttribute(R)==="0")stop()},${SAFETY_MS}[k]);
document.addEventListener("DOMContentLoaded",function(){var s=skip();if(s)s.focus({preventScroll:true})})}catch(x){}})()`;
