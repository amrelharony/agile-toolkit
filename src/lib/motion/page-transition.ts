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
 */

import { isSaveData } from "@/lib/holiday/save-data";
import {
  canStartViewTransition,
  isViewTransitionRunning,
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
}

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
  if (!w || key === null || (key !== w.to && key === w.from)) return;
  waiting = null;
  w.done();
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
  const to = routeKey(href);
  const why = refusal(to, options);
  const router = navigator_;
  if (!router || to === null || (why && (ALONE.includes(why) || !isViewTransitionRunning()))) {
    record(href, "instant", start, start, why);
    if (!options.plain) return false;
    go(options.plain, href, options);
    return true;
  }

  const from = routeKey(window.location.href) ?? "";
  let arrived: number | null = null;
  let recorded = false;
  const fallBack = () => {
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
      if (recorded) return;
      recorded = true;
      const end = arrived ?? performance.now();
      record(href, OUTCOME[outcome], start, end, why || (outcome === "plain" ? "busy" : undefined));
    }, fallBack)
    .finally(flushAfter);
  return true;
}
