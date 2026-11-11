/**
 * Back: the card slides back into its place (lib/motion/page-transition.ts,
 * the slide in lib/motion/grow-from.ts). RouteSignal is rendered for real,
 * with next/navigation mocked, so its popstate listener and its arrival
 * report are the ones the app runs.
 *
 * A history step here goes as it does in Chrome (seen in Chrome 157): the
 * Navigation API's navigate event fires while the leaving page is still
 * there, then the address changes and the browser fires popstate. Chrome runs
 * a window's listeners in the order they were added, capture or not, so
 * Next's own listener, added first, runs first and puts the old page back
 * inside that event (React renders a popstate update at once); Next's
 * history update in that commit fires a navigate event of its own (a
 * replace). Only after the event does the browser put the scroll position
 * back, and with globals.css's smooth scrolling on html it glides there, so
 * the card is still far off in the next frame, unless html's scroll-behavior
 * is auto then. jsdom runs capture listeners first, so Next's stand-in
 * listens in the capture phase, added before RouteSignal's: that is Chrome's
 * order. requestAnimationFrame is a stub that runs when the test says,
 * element.animate a stub that records, and getBoundingClientRect places the
 * header and the cards. jsdom has no Navigation API, so window.navigation is
 * a fake that keeps the entries as Chrome does (a push adds one with a new
 * key, Back and Forward move) and fires navigate events.
 *
 * What must hold: it plays only when hasUAVisualTransition is exactly false
 * (on the navigate event and on popstate), the step undoes the card's own
 * visit (from the entry its page arrived in to the entry the card was tapped
 * on), and a [data-vt-card] for that page is on screen (the one nearest where
 * the card was tapped when several are); never under reduced motion,
 * Save-Data, presenting or an intro; and the listeners only read, never
 * stopping or preventing popstate or the step.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
  }),
}));

import { RouteSignal } from "@/components/motion/route-signal";
import TransitionLink from "@/components/motion/transition-link";
import { ToolCard } from "@/components/shared/tool-card";
import { ComicCard } from "@/app/(tools)/comics/components/comic-card";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { RETURN_MS } from "@/lib/motion/grow-from";
import {
  BACK_WAIT_MS,
  isPageTransitionRunning,
  readDebugSwitches,
} from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { DUR, EASE } from "@/lib/motion/tokens";
import { comicHref } from "@/lib/comics/entry";
import type { StorySummary } from "@/lib/comics/types";
import { flush, installViewTransitions, removeViewTransitions } from "./fake-view-transitions";

const root = document.documentElement;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** jsdom's window is 1024 by 768. */
const CARD: Box = { left: 16, top: 400, width: 343, height: 180 };
const HEADER: Box = { left: 12, top: 80, width: 351, height: 120 };
/** How far off the cards sit during the commit, before the browser puts the scroll back. */
const BEFORE_RESTORE = 900;

function rect(b: Box): DOMRect {
  return {
    ...b,
    x: b.left,
    y: b.top,
    right: b.left + b.width,
    bottom: b.top + b.height,
    toJSON: () => b,
  } as DOMRect;
}

/** Where each card sits once the scroll is back, by the text of its first link. */
let cardAt: (name: string) => Box = () => CARD;
let headerAt: Box = HEADER;
let restored = true;
/** The browser's scroll back is gliding (smooth): it lands after the next frame. */
let gliding = false;
/**
 * After popstate the browser owes the scroll, as Chrome may: it puts it back
 * at the first layout read (a box or the scroll position) or at the frame's
 * own layout, at once when html's scroll-behavior is auto then, else gliding.
 */
let owed = false;
function putScrollBack() {
  if (!owed) return;
  owed = false;
  if (scrollIsInstant()) restored = true;
  else gliding = true;
}

function place() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    putScrollBack();
    if (this.matches("header[data-vt-target]")) return rect(headerAt);
    if (this.hasAttribute("data-vt-card")) {
      const b = cardAt(this.querySelector("a")?.textContent ?? "");
      return rect(restored ? b : { ...b, top: b.top + BEFORE_RESTORE });
    }
    return rect({ left: 0, top: 0, width: 0, height: 0 });
  });
}

const STORY: StorySummary = {
  ep: 30,
  title: "The quiet stand-up",
  lesson: "Say the blocker first.",
  castNames: [],
  themes: [],
  cover: null,
  releaseAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const kanban = (title = "Kanban") => (
  <ToolCard key={title} href="/kanban" icon={null} title={title} description="Flow" />
);
const retro = <ToolCard href="/retro" icon={null} title="Retro" description="Look back" />;
const home = (...cards: ReactNode[]) => <div>{cards.length ? cards : [kanban(), retro]}</div>;
const toolPage = (title = "Kanban Board") => (
  <ToolPageWrapper title={title} description="Visualise work" showInsights={false}>
    <p>Board</p>
  </ToolPageWrapper>
);

function App({ page }: { page: ReactNode }) {
  return (
    <>
      <RouteSignal />
      {page}
    </>
  );
}

let view: ReturnType<typeof render>;
let animate = vi.fn();

/** Puts `page` in place at `href`, as Next's router does (the address is already there). */
function show(href: string, page: ReactNode) {
  const url = new URL(href, window.location.href);
  nav.pathname = url.pathname;
  nav.search = url.search.slice(1);
  view.rerender(<App page={page} />);
}

/**
 * The session history as the Navigation API shows it: each entry's key and
 * address, and which one is current. Keys are never reused, not even across
 * tests, as real ones are unique.
 */
interface Entry {
  key: string;
  href: string;
}
let entries: Entry[] = [];
let current = 0;
let keys = 0;

const newEntry = (href: string): Entry => ({ key: `entry-${++keys}`, href });

/** Every navigate event the fake fired, with a spy for intercept (a listener must never call it). */
let steps: { event: Event; intercept: ReturnType<typeof vi.fn> }[] = [];

function installNavigation() {
  entries = [newEntry(window.location.pathname)];
  current = 0;
  steps = [];
  const nav = new EventTarget();
  Object.defineProperty(nav, "currentEntry", { get: () => ({ key: entries[current].key }) });
  Object.defineProperty(window, "navigation", { configurable: true, value: nav });
}

/**
 * The navigate event, fired before the step changes anything: a traverse
 * names the entry it goes to; a push or replace has no key yet.
 */
const MISSING = Symbol("no hasUAVisualTransition field");

function navigateEvent(navigationType: string, to: Entry | { key: ""; href: string }, ua: unknown) {
  const nav = (window as { navigation?: EventTarget }).navigation;
  if (!nav) return;
  const event = new Event("navigate", { cancelable: true });
  const intercept = vi.fn();
  Object.defineProperties(event, {
    navigationType: { value: navigationType },
    destination: { value: { key: to.key, url: new URL(to.href, window.location.href).href } },
    intercept: { value: intercept },
  });
  if (ua !== undefined && ua !== MISSING) {
    Object.defineProperty(event, "hasUAVisualTransition", { value: ua });
  }
  steps.push({ event, intercept });
  nav.dispatchEvent(event);
}

/** A push, as Next's router makes for a new page: the entries ahead go, a new one is added. */
function push(href: string) {
  navigateEvent("push", { key: "", href }, false);
  entries = [...entries.slice(0, current + 1), newEntry(href)];
  current = entries.length - 1;
  window.history.pushState(null, "", href);
}

/**
 * The browser's part of a history step, before popstate: the navigate event
 * (its hasUAVisualTransition is `ua`), then the entry and the address change.
 */
function move(delta: number, ua: unknown = false): string {
  const to = entries[current + delta];
  navigateEvent("traverse", to, ua);
  current += delta;
  window.history.replaceState(null, "", to.href);
  return to.href;
}

/** Taps a card's main link, then its page comes in, as any forward change ends. */
function open(name: string | RegExp, href: string, page: ReactNode = toolPage()) {
  fireEvent.click(screen.getByRole("link", { name }));
  push(href);
  show(href, page);
}

/** A plain change to `href`, not from a card. */
function visit(href: string, page: ReactNode) {
  push(href);
  show(href, page);
}

/**
 * What Next's own popstate listener does: put the page back. Its history
 * update in that commit is a replace, which fires a navigate event too.
 */
let restore: (() => void) | null = null;
function nextRestores() {
  const run = restore;
  restore = null;
  run?.();
}

/** Next's listener, as added before RouteSignal's: in Chrome it runs first. */
const NEXT_FIRST = { capture: true } as const;

function popstate(hasUAVisualTransition?: unknown): PopStateEvent {
  const event = new PopStateEvent("popstate", { state: { __NA: true } });
  if (hasUAVisualTransition !== undefined) {
    Object.defineProperty(event, "hasUAVisualTransition", { value: hasUAVisualTransition });
  }
  return event;
}

/** html's scroll-behavior as the browser uses it: globals.css makes it smooth. */
function scrollIsInstant(): boolean {
  return root.style.getPropertyValue("scroll-behavior") === "auto";
}

/**
 * A history step of `delta` entries: the navigate event, the entry and the
 * address change, popstate fires, Next's listener puts `page` back inside the
 * event, and after it the browser owes the scroll (putScrollBack). The
 * navigate event's hasUAVisualTransition is the popstate's unless `ua` says
 * otherwise. Returns the event.
 */
function go(
  delta: number,
  page: ReactNode,
  event: PopStateEvent = popstate(false),
  ua: unknown = event.hasUAVisualTransition
) {
  const href = move(delta, ua);
  restore = () => {
    navigateEvent("replace", { key: "", href }, false);
    show(href, page);
  };
  restored = false;
  window.dispatchEvent(event);
  owed = true;
  return event;
}

const back = (page: ReactNode, event?: PopStateEvent, ua?: unknown) => go(-1, page, event, ua);
const forward = (page: ReactNode, event?: PopStateEvent) => go(1, page, event);

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const realRaf = window.requestAnimationFrame;
const realCancel = window.cancelAnimationFrame;
const realScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

/**
 * Runs the frame the browser paints next: its callbacks, then its own layout,
 * which puts an owed scroll back. A glide begun before this frame lands in it.
 */
function nextFrame() {
  const landing = gliding;
  const due = Array.from(frames.values());
  frames.clear();
  for (const callback of due) callback(performance.now());
  putScrollBack();
  if (landing) {
    gliding = false;
    restored = true;
  }
}

/** Whether the browser put the scroll back at once (no glide). */
const scrollLandedAtOnce = () => restored && !gliding && !owed;

/** The slides that played on a card (the header grow on the way in is not one). */
function slides() {
  return animate.mock.calls.flatMap((call, i) => {
    const el = animate.mock.contexts[i] as Element;
    return el.hasAttribute("data-vt-card") ? [{ el, keyframes: call[0], options: call[1] }] : [];
  });
}

function card(name: string | RegExp): Element {
  return screen.getByRole("link", { name }).closest("[data-vt-card]")!;
}

/** The one slide, on `name`'s card, from `from` into the card's slot at `slot`. */
function expectSlide(
  name: string | RegExp,
  slot: Box = CARD,
  from = { left: HEADER.left, top: HEADER.top }
) {
  const played = slides();
  expect(played).toHaveLength(1);
  expect(played[0].el).toBe(card(name));
  expect(played[0].keyframes).toEqual([
    { translate: `${from.left - slot.left}px ${from.top - slot.top}px` },
    { translate: "0px 0px" },
  ]);
  expect(played[0].options).toEqual({ duration: RETURN_MS, easing: EASE.glide });
}

function stopBrowser(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  nav.pathname = "/";
  nav.search = "";
  cardAt = () => CARD;
  headerAt = HEADER;
  restored = true;
  gliding = false;
  owed = false;
  // Reading the scroll position is a layout read too.
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => {
      putScrollBack();
      return 0;
    },
  });
  animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  frames.clear();
  window.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  // Added before RouteSignal's, and run before it, as Chrome runs them: the
  // page is back before RouteSignal's popstate listener runs.
  window.addEventListener("popstate", nextRestores, NEXT_FIRST);
  window.addEventListener("click", stopBrowser);
  installNavigation();
  place();
  view = render(<App page={home()} />);
});

afterEach(async () => {
  skipViewTransition();
  await flush();
  cleanup();
  restore = null;
  window.removeEventListener("popstate", nextRestores, NEXT_FIRST);
  window.removeEventListener("popstate", nextRestores);
  window.removeEventListener("click", stopBrowser);
  root.style.removeProperty("scroll-behavior");
  if (realScrollY) Object.defineProperty(window, "scrollY", realScrollY);
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancel;
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  delete (window as { navigation?: unknown }).navigation;
  vi.restoreAllMocks();
  removeViewTransitions();
  delete root.dataset.intro;
  delete root.dataset.presenting;
  delete (navigator as { connection?: unknown }).connection;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  readDebugSwitches();
});

describe("on Back the tapped card slides back into its slot", () => {
  it("from the leaving page's header, translate only, in the settle duration on glide", () => {
    // A shared token (DNA-SPEC section 8), the one nearest the design's 0.3 s.
    expect(RETURN_MS).toBe(DUR.settle);
    open("Kanban", "/kanban");
    back(home());
    // Next put the home page back inside the event: the header is gone, so it
    // was measured at the navigate event, before any popstate listener ran.
    expect(document.querySelector("header[data-vt-target]")).toBeNull();
    // Nothing yet: in the commit the browser had not put the scroll back.
    expect(slides()).toEqual([]);
    nextFrame();
    expectSlide("Kanban");
    // No fill, and nothing but translate: no clip, fade or scale.
    expect(slides()[0].options).not.toHaveProperty("fill");
    expect(Object.keys(slides()[0].keyframes[0])).toEqual(["translate"]);
  });

  it("when Next's popstate listener, added first, runs first and puts the page back (Chrome)", () => {
    open("Kanban", "/kanban");
    // What RouteSignal's popstate listener finds when it runs: in Chrome a
    // window's listeners run in the order they were added, capture or not.
    let atPopstate: { header: boolean; path: string } | null = null;
    const late = () => {
      atPopstate = {
        header: document.querySelector("header[data-vt-target]") !== null,
        path: nav.pathname,
      };
    };
    window.addEventListener("popstate", late);
    try {
      back(home());
    } finally {
      window.removeEventListener("popstate", late);
    }
    expect(atPopstate).toEqual({ header: false, path: "/" });
    nextFrame();
    expectSlide("Kanban");
  });

  it("when RouteSignal's popstate listener runs before Next's", () => {
    // Next's listener added again, after RouteSignal's, so it runs last.
    window.removeEventListener("popstate", nextRestores, NEXT_FIRST);
    window.addEventListener("popstate", nextRestores);
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("when Next's history update in that commit fires a navigate event of its own", () => {
    open("Kanban", "/kanban");
    back(home());
    // The replace from Next's history update, while it put the page back.
    expect(steps.map((s) => (s.event as { navigationType?: string }).navigationType)).toEqual([
      "push",
      "traverse",
      "replace",
    ]);
    nextFrame();
    expectSlide("Kanban");
  });

  it("once: a later frame or render does not slide it again", () => {
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    show("/", home());
    nextFrame();
    expect(slides()).toHaveLength(1);
  });

  it("each time Back undoes the card's visit, after Forward too", () => {
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    forward(toolPage());
    nextFrame();
    expect(slides()).toHaveLength(1);
    back(home());
    nextFrame();
    expect(slides()).toHaveLength(2);
  });

  it("after the card's frame grew into the header through a view transition", async () => {
    const { made } = installViewTransitions();
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    expect(router.push).toHaveBeenCalledWith("/kanban", { scroll: true });
    push("/kanban");
    show("/kanban", toolPage());
    await flush();
    made[0].endAnimation();
    await flush();
    back(home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("for a comic card, back from its story (/comics?ep=30 to /comics)", () => {
    const gallery = (
      <ul>
        <ComicCard story={STORY} />
      </ul>
    );
    visit("/comics", gallery);
    open(/The quiet stand-up/, comicHref(30), toolPage(STORY.title));
    back(gallery);
    nextFrame();
    expectSlide(/The quiet stand-up/);
  });

  it("when Next brings the page back after the event, within BACK_WAIT_MS", () => {
    let now = 50_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    open("Kanban", "/kanban");
    move(-1);
    window.dispatchEvent(popstate(false));
    now += BACK_WAIT_MS - 1;
    show("/", home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("from the top edge when the leaving page's header was scrolled out of sight", () => {
    open("Kanban", "/kanban");
    headerAt = { ...HEADER, top: -900 };
    back(home());
    nextFrame();
    expectSlide("Kanban", CARD, { left: HEADER.left, top: 0 });
  });

  it("when the card is only partly on screen", () => {
    open("Kanban", "/kanban");
    const low = { ...CARD, top: 700 };
    cardAt = () => low;
    back(home());
    nextFrame();
    expectSlide("Kanban", low);
  });
});

describe("hasUAVisualTransition must be exactly false", () => {
  const values = [
    ["true: the browser played its own Back (an iPhone's swipe)", true],
    ["missing: a browser without the field", MISSING],
    ["anything else that is not false", 0],
  ] as const;

  it.each(values)("on both events: %s", (_name, value) => {
    open("Kanban", "/kanban");
    back(home(), popstate(value === MISSING ? undefined : value), value);
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it.each(values)("on the navigate event: %s", (_name, value) => {
    open("Kanban", "/kanban");
    back(home(), popstate(false), value);
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it.each(values)("on the popstate event: %s", (_name, value) => {
    open("Kanban", "/kanban");
    back(home(), popstate(value === MISSING ? undefined : value), false);
    nextFrame();
    expect(slides()).toEqual([]);
  });
});

describe("the step must undo the card's own visit", () => {
  it("not on a step past the card's old page, to another one", () => {
    visit("/retro", toolPage("Retro"));
    visit("/", home());
    open("Kanban", "/kanban");
    go(-2, toolPage("Retro"));
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("only on the step from the card's page: a page in between does not count", () => {
    open("Kanban", "/kanban");
    visit("/retro", toolPage("Retro"));
    // Back to the card's page: not the page it sat on.
    back(toolPage());
    nextFrame();
    expect(slides()).toEqual([]);
    // Then back again: from the card's page to the page it sat on.
    back(home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("not when Back leaves another page for the card's old page", () => {
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    expect(slides()).toHaveLength(1);
    // A new page replaces the card's in history; Back from it is not the card's way back.
    visit("/retro", toolPage("Retro"));
    back(home());
    nextFrame();
    expect(slides()).toHaveLength(1);
  });

  it("not when the card's page was opened again by a link that is not a card", () => {
    const page = home(
      kanban(),
      <TransitionLink key="plain" href="/kanban">
        Kanban again
      </TransitionLink>
    );
    show("/", page);
    open("Kanban", "/kanban");
    back(page);
    nextFrame();
    expect(slides()).toHaveLength(1);
    // The same page and the same card's old page, but a new entry the card never opened.
    open("Kanban again", "/kanban");
    back(page);
    nextFrame();
    expect(slides()).toHaveLength(1);
  });

  it("not on Forward into a newer entry for the card's old page", () => {
    open("Kanban", "/kanban");
    // Home again by a link: a newer entry for the page the card sat on.
    visit("/", home());
    back(toolPage());
    nextFrame();
    expect(slides()).toEqual([]);
    // From the card's page to its old page, but forward, into the newer entry.
    forward(home());
    nextFrame();
    expect(slides()).toEqual([]);
    // The card's own way back still slides it.
    back(toolPage());
    back(home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("not when the card's old entry now holds another address", () => {
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    expect(slides()).toHaveLength(1);
    // A replace on the card's old page: the same entry, a new query.
    entries[current] = { ...entries[current], href: "/?tab=jobs" };
    window.history.replaceState(null, "", "/?tab=jobs");
    show("/?tab=jobs", home());
    forward(toolPage());
    back(home());
    nextFrame();
    expect(slides()).toHaveLength(1);
    expect(root.style.getPropertyValue("scroll-behavior")).toBe("");
  });

  it("not when the card's page now shows another address in its entry", () => {
    open("Kanban", "/kanban");
    // A replace on the card's page: the same entry, another page to leave.
    entries[current] = { ...entries[current], href: "/kanban?view=list" };
    window.history.replaceState(null, "", "/kanban?view=list");
    show("/kanban?view=list", toolPage());
    back(home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not where the browser has no Navigation API to tell the entries apart", () => {
    delete (window as { navigation?: unknown }).navigation;
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when a newer page commits before the frame", () => {
    open("Kanban", "/kanban");
    back(home());
    // The newer page shows a Kanban card on screen too: only the cancel keeps it still.
    visit("/more-tools", home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when a tap comes before the frame", () => {
    open("Kanban", "/kanban");
    back(home());
    // A tap on the page that is back, before its first paint: it goes somewhere new.
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when a newer Back or Forward comes before the frame", () => {
    open("Kanban", "/kanban");
    back(home());
    // Forward again before the frame; Next has not put the tool page back yet.
    move(1);
    window.dispatchEvent(popstate(false));
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when Back comes while a page change is still holding the screen", async () => {
    const page = (
      <>
        {toolPage()}
        <TransitionLink href="/retro">Retro next</TransitionLink>
      </>
    );
    open("Kanban", "/kanban", page);
    installViewTransitions();
    fireEvent.click(screen.getByRole("link", { name: "Retro next" }));
    await flush();
    expect(isPageTransitionRunning()).toBe(true);
    back(home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when no popstate followed the navigate event", () => {
    open("Kanban", "/kanban");
    // The step began but never landed (another navigation took over), and the
    // card's old page came in some other way.
    move(-1);
    show("/", home());
    nextFrame();
    expect(slides()).toEqual([]);
    expect(root.style.getPropertyValue("scroll-behavior")).toBe("");
  });

  it("not when the page comes back later than BACK_WAIT_MS after Back", () => {
    let now = 50_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    open("Kanban", "/kanban");
    move(-1);
    window.dispatchEvent(popstate(false));
    now += BACK_WAIT_MS + 1;
    show("/", home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not for a link that only lends its spot: a related-tool tile is no card", () => {
    // A card's visit first, undone, so a record is there for the tile to keep.
    open("Retro", "/retro", toolPage("Retro"));
    back(home());
    nextFrame();
    expect(slides()).toHaveLength(1);
    const withTile = home(
      kanban(),
      <TransitionLink key="tile" href="/kanban" frame="spot">
        Kanban tile
      </TransitionLink>
    );
    show("/", withTile);
    open("Kanban tile", "/kanban");
    back(withTile);
    nextFrame();
    // Only the Retro card's slide from before.
    expect(slides()).toHaveLength(1);
  });
});

describe("the card for that page must be on screen", () => {
  it("not when it is below the screen once the scroll is back", () => {
    open("Kanban", "/kanban");
    cardAt = () => ({ ...CARD, top: 1200 });
    back(home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  // jsdom's window is 1024 by 768. Each box only touches the screen's edge.
  it.each([
    ["above the screen", { ...CARD, top: -CARD.height }],
    ["below the screen", { ...CARD, top: 768 }],
    ["left of the screen", { ...CARD, left: -CARD.width }],
    ["right of the screen", { ...CARD, left: 1024 }],
    ["of no width", { ...CARD, width: 0 }],
    ["of no height", { ...CARD, height: 0 }],
  ])("not when it is %s", (_name, box) => {
    open("Kanban", "/kanban");
    cardAt = () => box;
    back(home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when the page has no such card", () => {
    open("Kanban", "/kanban");
    back(home(retro));
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("of several on screen, the one nearest where the tapped card was", () => {
    const top = { ...CARD, top: 100 };
    const low = { ...CARD, top: 400 };
    cardAt = (name) => (name === "Kanban" ? top : low);
    const twice = home(kanban(), kanban("Kanban board"));
    show("/", twice);
    open("Kanban board", "/kanban");
    // The page came back 10px lower: still nearest the lower card.
    cardAt = (name) => (name === "Kanban" ? { ...top, top: 110 } : { ...low, top: 410 });
    back(twice);
    nextFrame();
    expectSlide("Kanban board", { ...low, top: 410 });
  });

  it("of several on screen, the nearest though it is neither first nor last", () => {
    const at: Record<string, Box> = {
      Kanban: { ...CARD, top: 40 },
      "Kanban board": { ...CARD, top: 300 },
      "Kanban lane": { ...CARD, top: 560 },
    };
    cardAt = (name) => at[name] ?? CARD;
    const three = home(kanban(), kanban("Kanban board"), kanban("Kanban lane"));
    show("/", three);
    open("Kanban board", "/kanban");
    back(three);
    nextFrame();
    expectSlide("Kanban board", at["Kanban board"]);
  });

  it("of several, only those on screen count", () => {
    const top = { ...CARD, top: 100 };
    cardAt = (name) => (name === "Kanban" ? top : CARD);
    const twice = home(kanban(), kanban("Kanban board"));
    show("/", twice);
    open("Kanban board", "/kanban");
    // Back, the tapped card is below the screen; the other is in view.
    cardAt = (name) => (name === "Kanban" ? top : { ...CARD, top: 1300 });
    back(twice);
    nextFrame();
    expectSlide("Kanban", top);
  });

  it("by the link that was tapped: another link in a card to the same page does not count", () => {
    // A job card's Other options link to the same tool sits second in its card.
    const job = (
      <div key="job" data-vt-card="">
        <TransitionLink href="/retro" frame>
          Run a retro
        </TransitionLink>
        <TransitionLink href="/kanban">Kanban instead</TransitionLink>
      </div>
    );
    const far = { ...CARD, top: 20 };
    cardAt = (name) => (name === "Kanban" ? far : CARD);
    const page = home(job, kanban());
    show("/", page);
    open("Kanban", "/kanban");
    // The job card now sits exactly where the Kanban card was tapped.
    cardAt = (name) => (name === "Kanban" ? { ...far, top: 30 } : far);
    back(page);
    nextFrame();
    expectSlide("Kanban", { ...far, top: 30 });
  });
});

describe("never", () => {
  it.each([
    [
      "under reduced motion",
      () =>
        vi
          .spyOn(window, "matchMedia")
          .mockImplementation(
            (query: string) =>
              ({ matches: query === "(prefers-reduced-motion: reduce)", media: query }) as never
          ),
    ],
    [
      "with Save-Data",
      () =>
        Object.defineProperty(navigator, "connection", {
          configurable: true,
          value: { saveData: true },
        }),
    ],
    [
      "on 2G",
      () =>
        Object.defineProperty(navigator, "connection", {
          configurable: true,
          value: { effectiveType: "2g" },
        }),
    ],
    ["while presenting", () => (root.dataset.presenting = "true")],
    ["with an intro on stage", () => (root.dataset.intro = "poster")],
  ])("%s", (_name, arrange) => {
    open("Kanban", "/kanban");
    arrange();
    back(home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("when the rule turns on between Back and the frame", () => {
    open("Kanban", "/kanban");
    back(home());
    root.dataset.presenting = "true";
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("where element.animate is missing", () => {
    open("Kanban", "/kanban");
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    back(home());
    expect(() => nextFrame()).not.toThrow();
    expect(card("Kanban").getAttribute("style")).toBeNull();
  });
});

describe("the listeners only read", () => {
  it("never stops popstate or prevents its default, and changes no page itself", () => {
    open("Kanban", "/kanban");
    router.push.mockClear();
    router.replace.mockClear();
    const after = vi.fn();
    window.addEventListener("popstate", after);
    const event = popstate(false);
    const calls = (["stopPropagation", "stopImmediatePropagation", "preventDefault"] as const).map(
      (method) => vi.spyOn(event, method)
    );
    try {
      back(home(), event);
    } finally {
      window.removeEventListener("popstate", after);
    }
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    // Every other listener, Next's included, still had it.
    expect(after).toHaveBeenCalledTimes(1);
    expect(restore).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    nextFrame();
    expectSlide("Kanban");
  });

  it("never intercepts, stops or prevents the navigate event", () => {
    open("Kanban", "/kanban");
    const nav = (window as unknown as { navigation: EventTarget }).navigation;
    const after = vi.fn();
    nav.addEventListener("navigate", after);
    const before = steps.length;
    const calls = (["stopPropagation", "stopImmediatePropagation", "preventDefault"] as const).map(
      (method) => vi.spyOn(Event.prototype, method)
    );
    try {
      back(home());
    } finally {
      nav.removeEventListener("navigate", after);
    }
    const made = steps.slice(before);
    // The traverse, then Next's replace while it put the page back.
    expect(made).toHaveLength(2);
    for (const { event, intercept } of made) {
      expect(intercept).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      for (const call of calls) expect(call.mock.contexts).not.toContain(event);
    }
    // Each one reached the listener added after RouteSignal's.
    expect(after).toHaveBeenCalledTimes(2);
    nextFrame();
    expectSlide("Kanban");
  });

  it("goes when RouteSignal does", () => {
    open("Kanban", "/kanban");
    cleanup();
    // A header is still there to measure: only a listener left behind would note the step.
    const header = document.body.appendChild(document.createElement("header"));
    header.setAttribute("data-vt-target", "");
    try {
      move(-1);
      window.dispatchEvent(popstate(false));
      view = render(<App page={home()} />);
      nextFrame();
      expect(slides()).toEqual([]);
    } finally {
      header.remove();
    }
  });
});

describe("for a Back that slides, the browser puts the scroll back at once", () => {
  const scrollBehavior = () => root.style.getPropertyValue("scroll-behavior");

  it("html's scroll-behavior is auto from the navigate event to the slide's frame", () => {
    open("Kanban", "/kanban");
    let duringPopstate = "";
    const read = () => (duringPopstate = scrollBehavior());
    window.addEventListener("popstate", read);
    try {
      back(home());
    } finally {
      window.removeEventListener("popstate", read);
    }
    // Still auto after the event, when the browser puts the scroll back.
    expect(duringPopstate).toBe("auto");
    expect(scrollBehavior()).toBe("auto");
    nextFrame();
    expectSlide("Kanban");
    // Given back: globals.css's smooth scrolling is html's again.
    expect(scrollBehavior()).toBe("");
  });

  it("a scroll the browser still owes in the slide's frame comes back at once", () => {
    open("Kanban", "/kanban");
    back(home());
    // Owed past the event, as Chrome sometimes leaves it until the frame.
    expect(restored).toBe(false);
    nextFrame();
    expect(scrollLandedAtOnce()).toBe(true);
    expectSlide("Kanban");
  });

  it("at once even when the page has no card to slide", () => {
    open("Kanban", "/kanban");
    back(home(retro));
    nextFrame();
    expect(scrollLandedAtOnce()).toBe(true);
    expect(slides()).toEqual([]);
  });

  it("a Back that may not slide keeps the glide it has today", () => {
    open("Kanban", "/kanban");
    back(home(), popstate(true));
    nextFrame();
    expect(gliding).toBe(true);
  });

  it("html's own inline scroll-behavior comes back as it was", () => {
    root.style.setProperty("scroll-behavior", "smooth");
    open("Kanban", "/kanban");
    move(-1);
    expect(scrollBehavior()).toBe("auto");
    window.dispatchEvent(popstate(false));
    show("/", home());
    nextFrame();
    expect(scrollBehavior()).toBe("smooth");
  });

  it("left alone when the browser animated Back itself", () => {
    open("Kanban", "/kanban");
    back(home(), popstate(true));
    expect(scrollBehavior()).toBe("");
  });

  it("left alone when the popstate event alone says the browser animated Back", () => {
    open("Kanban", "/kanban");
    back(home(), popstate(true), false);
    expect(scrollBehavior()).toBe("");
  });

  it("left alone on a step that is not the card's way back", () => {
    open("Kanban", "/kanban");
    back(home());
    nextFrame();
    forward(toolPage());
    expect(scrollBehavior()).toBe("");
  });

  it.each([
    ["a tap", () => fireEvent.click(screen.getByRole("link", { name: "Retro" }))],
    ["a newer page", () => visit("/more-tools", home())],
    ["a newer step", () => move(1)],
    ["RouteSignal going", () => cleanup()],
  ])("given back when %s comes before the frame", (_name, then) => {
    open("Kanban", "/kanban");
    back(home());
    expect(scrollBehavior()).toBe("auto");
    then();
    expect(scrollBehavior()).toBe("");
  });
});

describe("Back and Forward never grow a header", () => {
  // The header animations Chrome shows straight after Back are the top bar's
  // colour transitions (it turns opaque once the page is scrolled), not this.
  it("only the card's page grows its header, once, on the way in", async () => {
    const grown = () =>
      animate.mock.contexts.filter((el) => (el as Element).matches("header[data-vt-target]"));
    open("Kanban", "/kanban");
    await Promise.resolve();
    // The grow from the card's spot: no view transition carried the frame here.
    expect(grown()).toHaveLength(1);
    back(home());
    nextFrame();
    await Promise.resolve();
    forward(toolPage());
    nextFrame();
    await Promise.resolve();
    expect(grown()).toHaveLength(1);
    expect(slides()).toHaveLength(1);
  });
});
