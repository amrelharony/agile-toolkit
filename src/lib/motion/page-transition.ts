/**
 * Page changes (DNA-SPEC section 8: "Page changes run one at a time, and only
 * to a page that is already loaded ahead"). A change cross-fades only when
 * every rule below allows it; otherwise it is instant, exactly as before.
 * The hold itself (the cap, the held layers, the clean-up) lives in
 * ./view-transition.ts, the one place a view transition starts.
 *
 * How a change runs. TransitionLink and the tool finder ask
 * pushWithTransition. When it may move, the browser keeps the old picture,
 * the router push happens inside the update, and the update waits for
 * RouteSignal to report the new page from its layout effect
 * (notifyRouteCommitted), in the same commit that puts the page in place.
 * Nothing here waits for a frame, an observer or an animation event: the
 * browser pauses those while it holds the old picture, so such a wait would
 * always run into the cap. Past HOLD_CAP_MS the change is skipped and the
 * page swaps plainly when it arrives.
 *
 * Instant (the caller, usually next/link, changes the page itself) when:
 * - no router is registered (RouteSignal is not mounted);
 * - the link leaves the site, or keeps the same path and query;
 * - the link only lends its spot (frame="spot": a related-tool tile);
 * - the page is not loaded ahead: prefetch={false}, or a force-dynamic page;
 * - either page is a bare route (sign-in, guest, join);
 * - the link sits in a dialog or a data-vt-instant zone (the open phone menu);
 * - ?vt=off is on, Save-Data or 2G, or the browser cannot run one now (no
 *   view transitions, reduced motion, presenting, an intro, a hidden tab).
 * While a change runs, the next tap skips it and changes the page plainly,
 * behind it, so the last tap always wins.
 *
 * Measuring: each tap adds one performance.measure("page-change") entry and
 * one row to an in-memory list of the last 20, which ?vt-log=1 shows on the
 * page (components/motion/vt-log.tsx). Nothing is sent anywhere.
 *
 * A card's frame (TransitionLink's frame prop). When a tool, job or comic
 * card's main link changes the page with a transition, the card's paper frame
 * grows into the new page's header panel. The card ([data-vt-card]) carries
 * data-vt-active for the old picture; at the arrival the mark moves to the
 * first [data-vt-target] (the header), so exactly one element carries the
 * name in each picture (two would make the browser skip the whole change).
 * html[data-vt-frame] says which look the frame takes: "pair" once a header
 * took the mark, "exit" when the new page has none (the old card fades out).
 * The mark moves in RouteSignal's layout effect, like the arrival itself:
 * nothing on the hold path waits for a frame.
 * Every frame link also leaves an arrival record: where the card was and when.
 * When no transition carried the frame (Safari 17, a page that missed the
 * hold, a link that does not load ahead, frame="spot"), the new page's header
 * grows from that spot instead (lib/motion/grow-from.ts).
 *
 * Back (DNA-SPEC: "on back and forward (where only the card's slide back may
 * play)"). Back and Forward never run a view transition: Next puts the page
 * back in its own popstate listener, and wrapping that would fight the
 * browser's scroll restoration and the iPhone's swipe. A card's tap also
 * leaves a forward record: the page it sat on, the page it opened, which of
 * its links was tapped and where it was. RouteSignal's popstate listener only
 * reads (noteHistoryStep). When the browser played no Back animation of its
 * own, and the step leaves the card's page for the page the card sat on, the
 * leaving page's header is measured while it is still there. Once the page
 * is back (notifyRouteCommitted) and the browser has put its scroll back, the
 * card for that page that is on screen, the one nearest where it was tapped,
 * slides from the header's spot into its slot (slideBack). Otherwise Back
 * stays instant, as before.
 */

import { isSaveData } from "@/lib/holiday/save-data";
import { canGrow, slideBack } from "./grow-from";
import { isIntroOnStage } from "./stage";
import {
  canStartViewTransition,
  isViewTransitionRunning,
  skipViewTransition,
  withViewTransition,
  type ViewTransitionOutcome,
} from "./view-transition";

/** The longest the screen holds still for a page that has not arrived (an owner decision). */
export const HOLD_CAP_MS = 150;

/**
 * The pages that export dynamic = "force-dynamic". A prefetch of one carries
 * no page data (no loading.tsx exists), so holding for it would freeze the
 * screen and then skip anyway. test/motion/page-transition.test.ts reads the
 * list from disk.
 */
export const DYNAMIC_PATHS: readonly string[] = [
  "/comics/early",
  "/meet-the-cast",
  "/squad-session",
  "/vip",
  "/which-colleague",
];

/** What a page change needs from the app router. RouteSignal registers it. */
export interface PageNavigator {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
}

export interface PageChangeOptions {
  replace?: boolean;
  scroll?: boolean;
  /** The tapped link. One in a dialog or a data-vt-instant zone changes the page instantly. */
  source?: Element | null;
  /** next/link's prefetch. false: the page is not loaded ahead, so the change is instant. */
  prefetch?: boolean | null;
  /** Changes the page when no transition runs. Without it the caller does (next/link does). */
  plain?: PageNavigator | null;
  /**
   * The tapped link is a card's main link. true: the card's frame may grow
   * into the new page's header. "spot": the change is instant, and only the
   * card's spot is kept, so the header grows from it.
   */
  frame?: FrameMode;
}

/** A card's main link: true for a frame that may grow into the header, "spot" for the header grow only. */
export type FrameMode = boolean | "spot";

/** Where the tapped card was, in viewport pixels at the tap. */
export interface CardSpot {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a frame link leaves for the new page's header. */
export interface PageArrival {
  /** The page it is for: path plus query. */
  to: string;
  spot: CardSpot;
  /** When the card was tapped, from performance.now(). */
  at: number;
  /** Whether a view transition carried the card's frame into the header. */
  viewTransition: boolean;
}

/** How long after the tap a new page's header may still grow from the card's spot. */
export const GROW_WINDOW_MS = 1500;

/** ran: it moved. capped: the page missed the hold. fallback: skipped, the page changed plainly. instant: a rule said no. */
export type PageChangeOutcome = "ran" | "capped" | "fallback" | "instant";

export interface PageChangeEntry {
  href: string;
  outcome: PageChangeOutcome;
  /** The rule behind an instant change, or "assign" when the router failed. */
  why?: string;
  /** How long the screen held still, in ms. */
  waited: number;
  /** When it ended, from Date.now(). */
  at: number;
}

export interface DebugSwitches {
  /** ?vt-log=1: show the last 20 taps on the page. */
  log: boolean;
  /** ?vt=off: change pages without view transitions, as browsers without them do. */
  off: boolean;
}

const KIND = "page";
const LOG_SIZE = 20;
const LOG_KEY = "agile-toolkit:vt-log";
const OFF_KEY = "agile-toolkit:vt-off";
/** Refusals that never queue behind a running change: the browser or next/link handles them alone. */
const ALONE = ["no-router", "external", "same-page"];
const OUTCOME: Record<ViewTransitionOutcome, PageChangeOutcome> = {
  ran: "ran",
  capped: "capped",
  skipped: "fallback",
  plain: "instant",
};

let navigator_: PageNavigator | null = null;
let isBare: (pathname: string) => boolean = () => false;
let waiting: { to: string; from: string; done: () => void } | null = null;
let switches: DebugSwitches | null = null;
let after: (() => void)[] = [];
const log: PageChangeEntry[] = [];
const listeners = new Set<(entry: PageChangeEntry) => void>();

/** The frame of the change running now: the element with the mark, and whether it lands on a header. */
interface FrameChange {
  marked: Element;
  landing: boolean;
  arrival: PageArrival;
}

const ACTIVE_ATTR = "data-vt-active";
const FRAME_ATTR = "data-vt-frame";

let frame: FrameChange | null = null;
let lastArrival: PageArrival | null = null;

/** Where a card was tapped, for its slide back on Back. */
interface CardOrigin {
  /** The page the card sat on, and the page it opened: path plus query. */
  from: string;
  to: string;
  /**
   * Which of the card's links was tapped. A card for that page is one whose
   * link at this place goes there, so a job card's Other options link to the
   * same tool never counts.
   */
  link: number;
  /** The card's box at the tap. */
  spot: CardSpot;
}

/** A Back to a card's page, from the popstate until the page is back. */
interface CardReturn {
  origin: CardOrigin;
  /** Where the leaving page's header was, in viewport pixels: the slide starts there. */
  from: { left: number; top: number };
  /** When Back happened, from performance.now(). */
  at: number;
}

/**
 * How long after Back the page may come back and still slide its card. Next
 * restores a page it holds inside the popstate event; one it must fetch
 * again comes later, by which time Back has long looked instant.
 */
export const BACK_WAIT_MS = 1000;

/** The last card tap. Only another card's tap replaces it, so each Back to that page may slide it. */
let origin: CardOrigin | null = null;
let returning: CardReturn | null = null;
/** The animation frame the slide back waits for, or 0. */
let returnFrame = 0;
/** The page RouteSignal reported last: during a popstate, the page being left. */
let shown: string | null = null;

/**
 * The last resort when the router push throws: a full page load. An object,
 * so tests can watch it (jsdom's location cannot be spied on).
 */
export const fallbackNavigation = {
  assign(href: string): void {
    window.location.assign(href);
  },
};

/** RouteSignal lends its router, and the shell's bare-route test. Returns the unregister call. */
export function registerNavigator(
  next: PageNavigator,
  bare?: (pathname: string) => boolean
): () => void {
  navigator_ = next;
  if (bare) isBare = bare;
  return () => {
    if (navigator_ === next) navigator_ = null;
  };
}

/** Path plus normalised query, or null for another origin. */
function routeKey(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const query = new URLSearchParams(url.search).toString();
    return query ? `${url.pathname}?${query}` : url.pathname;
  } catch {
    return null;
  }
}

/**
 * The new page is in place: RouteSignal calls this from a layout effect.
 * A waiting change ends its hold when this is its page, or any page other
 * than the one it left (a redirect lands somewhere else).
 */
export function notifyRouteCommitted(href: string): void {
  const w = waiting;
  const key = routeKey(href);
  if (key !== null) shown = key;
  slideBackOn(key);
  if (!w || key === null || (key !== w.to && key === w.from)) return;
  waiting = null;
  // Here, in the commit and before the new picture: the new page's header
  // is in place, and a later layout effect (the header's grow) sees the move.
  landFrame();
  w.done();
}

/**
 * The new page is in place: the mark leaves the card for the first header
 * that can take it, so the new picture has exactly one frame. With none, the
 * frame exits ("exit": the old card fades out). An intro on the new page
 * takes the stage instead: the change is skipped and the page swaps plainly.
 */
function landFrame(): void {
  const f = frame;
  if (!f) return;
  if (!isPageTransitionRunning()) {
    endFrame(f);
    return;
  }
  if (isIntroOnStage()) {
    endFrame(f);
    skipViewTransition();
    return;
  }
  f.marked.removeAttribute(ACTIVE_ATTR);
  const header = document.querySelector("[data-vt-target]");
  if (!header) {
    f.landing = false;
    return;
  }
  header.setAttribute(ACTIVE_ATTR, "");
  document.documentElement.setAttribute(FRAME_ATTR, "pair");
  f.marked = header;
  f.arrival.viewTransition = true;
}

/** Takes the frame's mark and look away; only the change that set them may. */
function endFrame(f: FrameChange | null): void {
  if (!f || frame !== f) return;
  frame = null;
  f.marked.removeAttribute(ACTIVE_ATTR);
  document.documentElement.removeAttribute(FRAME_ATTR);
}

/**
 * Whether a card's frame is landing on the page now being put in place. The
 * new page's wrapper reads it once, on its first render: the frame is then
 * its entrance, so its own rise would play the entrance twice. False again
 * as soon as the change is capped or skipped, before the page renders.
 */
export function isFrameLanding(): boolean {
  return frame?.landing === true && isPageTransitionRunning();
}

/** The last frame link's arrival record, without using it up. */
export function arrivalRecord(): PageArrival | null {
  return lastArrival;
}

/**
 * For the new page's header, once: where the tapped card was, when the
 * header should grow from it. Null when no frame link opened this page, the
 * tap is over GROW_WINDOW_MS old, or a view transition carried the frame.
 */
export function takeGrowSpot(): CardSpot | null {
  const a = lastArrival;
  if (!a) return null;
  if (performance.now() - a.at > GROW_WINDOW_MS) {
    lastArrival = null;
    return null;
  }
  // Another page's header (a redirect, a later plain change) is not this card's.
  if (routeKey(window.location.href) !== a.to) return null;
  lastArrival = null;
  return a.viewTransition ? null : a.spot;
}

/** The card a frame link belongs to, or the link itself (a related-tool tile). */
function cardOf(source: Element): Element {
  return source.closest("[data-vt-card]") ?? source;
}

/**
 * Each tap replaces the last record: a frame link leaves a new one, any other
 * link none. Only for a change to another page of this site.
 */
function noteArrival(to: string | null, why: string, o: PageChangeOptions): PageArrival | null {
  lastArrival = null;
  if (!o.frame || !o.source || to === null || why === "same-page") return null;
  const card = cardOf(o.source);
  const r = card.getBoundingClientRect();
  const spot = { left: r.left, top: r.top, width: r.width, height: r.height };
  noteOrigin(card, o.source, to, spot);
  lastArrival = { to, spot, at: performance.now(), viewTransition: false };
  return lastArrival;
}

/** A card's links, in order. */
function linksOf(card: Element): Element[] {
  return Array.from(card.querySelectorAll("a[href]"));
}

/**
 * The forward record for the slide back: only for a card ([data-vt-card]),
 * never a link that only lends its spot (a related-tool tile is no card).
 */
function noteOrigin(card: Element, link: Element, to: string, spot: CardSpot): void {
  const from = routeKey(window.location.href);
  const at = card === link ? -1 : linksOf(card).indexOf(link);
  if (from === null || at < 0) return;
  origin = { from, to, link: at, spot };
}

function cancelSlideBack(): void {
  if (returnFrame) window.cancelAnimationFrame?.(returnFrame);
  returnFrame = 0;
}

/**
 * Back or Forward, from RouteSignal's popstate listener. It only reads: it
 * never stops the event or prevents its default, and changes nothing on the
 * page. It runs before Next's own listener, which puts the old page back, so
 * the leaving page's header is still there to measure.
 *
 * It notes a slide back when the browser played no Back animation of its own
 * (hasUAVisualTransition exactly false: true after an iPhone's swipe, and a
 * browser without the field leaves it undefined), the step leaves the page a
 * card opened for the page the card sat on, and nothing rules motion out.
 */
export function noteHistoryStep(event: PopStateEvent): void {
  cancelSlideBack();
  returning = null;
  const o = origin;
  if (!o || event.hasUAVisualTransition !== false) return;
  if (routeKey(window.location.href) !== o.from || shown !== o.to) return;
  if (isPageTransitionRunning() || !canGrow()) return;
  const header = document.querySelector("[data-vt-target]");
  if (!header) return;
  const r = header.getBoundingClientRect();
  // A header scrolled out of sight lends the top edge of the screen.
  returning = {
    origin: o,
    from: { left: r.left, top: r.bottom > 0 ? r.top : 0 },
    at: performance.now(),
  };
}

/**
 * A page is back in place (notifyRouteCommitted, from RouteSignal's layout
 * effect). When it is the page a noted Back returns to, the card slides back
 * in the next animation frame, not now: React puts the page back inside the
 * popstate event, and the browser restores the scroll position only after
 * that event, so the card is not yet where it will be shown. That animation
 * frame still comes before the page's first paint, and no page change holds
 * the screen on Back to pause it. Any other page, a newer Back or a tap
 * cancels it.
 */
function slideBackOn(key: string | null): void {
  cancelSlideBack();
  const r = returning;
  returning = null;
  if (!r || key !== r.origin.from || typeof window.requestAnimationFrame !== "function") return;
  returnFrame = window.requestAnimationFrame(() => {
    returnFrame = 0;
    if (performance.now() - r.at > BACK_WAIT_MS) return;
    const card = returningCard(r.origin);
    if (card) slideBack(card, r.from);
  });
}

/**
 * The card to slide back, measured now: a [data-vt-card] whose tapped link
 * goes to the page Back left and that is on screen; of several, the one
 * nearest where the tapped card was. Null while a page change runs.
 */
function returningCard(o: CardOrigin): HTMLElement | null {
  if (isPageTransitionRunning()) return null;
  const width = window.innerWidth;
  const height = window.innerHeight;
  let best: HTMLElement | null = null;
  let nearest = Infinity;
  for (const card of Array.from(document.querySelectorAll<HTMLElement>("[data-vt-card]"))) {
    const href = linksOf(card)[o.link]?.getAttribute("href");
    if (!href || routeKey(href) !== o.to) continue;
    const b = card.getBoundingClientRect();
    const onScreen =
      b.width > 0 &&
      b.height > 0 &&
      b.bottom > 0 &&
      b.right > 0 &&
      b.top < height &&
      b.left < width;
    if (!onScreen) continue;
    const distance = Math.hypot(b.left - o.spot.left, b.top - o.spot.top);
    if (distance < nearest) {
      nearest = distance;
      best = card;
    }
  }
  return best;
}

/** Whether a page change is holding or animating now. */
export function isPageTransitionRunning(): boolean {
  return isViewTransitionRunning(KIND);
}

/** Runs `callback` once no page change runs: at once, or when the running one ends. */
export function afterPageTransition(callback: () => void): () => void {
  if (!isPageTransitionRunning()) {
    callback();
    return () => {};
  }
  after.push(callback);
  return () => {
    after = after.filter((c) => c !== callback);
  };
}

function flushAfter(): void {
  // A plain change behind a newer one can settle while that one still runs.
  if (isPageTransitionRunning()) return;
  const list = after;
  after = [];
  for (const callback of list) callback();
}

/**
 * Reads ?vt-log=1 / ?vt-log=0 and ?vt=off / ?vt=on into sessionStorage, and
 * returns what is stored. Storage that throws leaves both off.
 */
export function readDebugSwitches(): DebugSwitches {
  const read: DebugSwitches = { log: false, off: false };
  try {
    const query = new URLSearchParams(window.location.search);
    const store = window.sessionStorage;
    const set = (key: string, on: boolean | null) => {
      if (on === true) store.setItem(key, "1");
      else if (on === false) store.removeItem(key);
    };
    const vtLog = query.get("vt-log");
    const vt = query.get("vt");
    set(LOG_KEY, vtLog === "1" ? true : vtLog === "0" ? false : null);
    set(OFF_KEY, vt === "off" ? true : vt === "on" ? false : null);
    read.log = store.getItem(LOG_KEY) === "1";
    read.off = store.getItem(OFF_KEY) === "1";
  } catch {
    // Blocked storage: the switches stay off.
  }
  return (switches = read);
}

/** The last 20 taps, oldest first. */
export function pageChangeLog(): readonly PageChangeEntry[] {
  return log;
}

/** Calls `listener` with each tap's entry. Returns the unsubscribe call. */
export function onPageChange(listener: (entry: PageChangeEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function record(
  href: string,
  outcome: PageChangeOutcome,
  start: number,
  end: number,
  why?: string
) {
  const entry: PageChangeEntry = { href, outcome, waited: Math.round(end - start), at: Date.now() };
  if (why) entry.why = why;
  log.push(entry);
  if (log.length > LOG_SIZE) log.shift();
  try {
    performance.measure("page-change", { start, end, detail: { outcome, why, href } });
  } catch {
    // An older browser without the options form: the list still has it.
  }
  for (const listener of Array.from(listeners)) listener(entry);
}

/** Whether a force-dynamic page is the target: it is never loaded ahead. */
export function isDynamicPath(pathname: string): boolean {
  return DYNAMIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The first rule that keeps this change instant, or "" when it may move. */
function refusal(to: string | null, o: PageChangeOptions): string {
  if (!navigator_) return "no-router";
  if (to === null) return "external";
  if (to === routeKey(window.location.href)) return "same-page";
  // A tile that only lends its spot: the header grows from it, with no transition.
  if (o.frame === "spot") return "spot";
  if (o.prefetch === false) return "not-ahead";
  const path = to.split("?")[0];
  if (isDynamicPath(path)) return "dynamic";
  if (isBare(path) || isBare(window.location.pathname)) return "bare";
  if (o.source?.closest('[role="dialog"],[data-vt-instant]')) return "zone";
  if ((switches ?? readDebugSwitches()).off) return "vt-off";
  if (isSaveData()) return "save-data";
  if (!canStartViewTransition()) return "unavailable";
  return "";
}

function go(router: PageNavigator, href: string, o: PageChangeOptions): void {
  router[o.replace ? "replace" : "push"](href, { scroll: o.scroll ?? true });
}

/**
 * Change to `href`, cross-fading when every rule allows it. Returns true when
 * this call changes the page (with a transition, behind a running one, or
 * plainly through `options.plain`); false when the caller must, as next/link
 * does once its click is left alone.
 */
export function pushWithTransition(href: string, options: PageChangeOptions = {}): boolean {
  const start = performance.now();
  // A tap goes somewhere new: a card still to slide back on this page stays put.
  cancelSlideBack();
  returning = null;
  const to = routeKey(href);
  const why = refusal(to, options);
  const router = navigator_;
  const spot = noteArrival(to, why, options);
  if (!router || to === null || (why && (ALONE.includes(why) || !isViewTransitionRunning()))) {
    record(href, "instant", start, start, why);
    if (!options.plain) return false;
    go(options.plain, href, options);
    return true;
  }

  const from = routeKey(window.location.href) ?? "";
  let arrived: number | null = null;
  let recorded = false;
  // The card is marked before the browser takes the old picture (the call
  // below asks for it); only when a transition of its own starts.
  let mine: FrameChange | null = null;
  if (options.frame === true && spot && !why && !isViewTransitionRunning()) {
    mine = { marked: cardOf(options.source!), landing: true, arrival: spot };
    endFrame(frame);
    frame = mine;
    mine.marked.setAttribute(ACTIVE_ATTR, "");
    document.documentElement.setAttribute(FRAME_ATTR, "exit");
  }
  const fallBack = () => {
    endFrame(mine);
    if (!recorded) {
      recorded = true;
      record(href, "fallback", start, performance.now(), "assign");
    }
    fallbackNavigation.assign(href);
  };
  void withViewTransition(
    KIND,
    () => {
      // A change still waiting is superseded: it stops waiting now.
      waiting?.done();
      const arrival = new Promise<void>((done) => (waiting = { to, from, done }));
      go(router, href, options);
      return arrival.then(() => {
        arrived = performance.now();
      });
    },
    { capMs: HOLD_CAP_MS, onLateError: fallBack }
  )
    .then((outcome) => {
      // Finished, capped or skipped: the frame goes with the transition.
      endFrame(mine);
      if (recorded) return;
      recorded = true;
      const end = arrived ?? performance.now();
      record(href, OUTCOME[outcome], start, end, why || (outcome === "plain" ? "busy" : undefined));
    }, fallBack)
    .finally(flushAfter);
  // No transition of its own started (an earlier update the browser has not
  // begun, or the browser refused one): the page swaps plainly, with no frame,
  // and its header grows from the card's spot.
  if (mine && !isPageTransitionRunning()) endFrame(mine);
  return true;
}
