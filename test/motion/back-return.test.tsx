/**
 * Back: the card slides back into its place (lib/motion/page-transition.ts,
 * the slide in lib/motion/grow-from.ts). RouteSignal is rendered for real,
 * with next/navigation mocked, so its popstate listener and its arrival
 * report are the ones the app runs.
 *
 * A history step here goes as it does in Chrome: the address changes, the
 * browser fires popstate, Next's own listener puts the old page back inside
 * that event (React renders a popstate update at once), and only after the
 * event does the browser put the scroll position back. So during the commit
 * the cards are not yet where they will be shown; the slide measures them in
 * the next frame, before the first paint. requestAnimationFrame is a stub
 * that runs when the test says, element.animate a stub that records, and
 * getBoundingClientRect places the header and the cards.
 *
 * What must hold: it plays only when hasUAVisualTransition is exactly false,
 * the step leaves the card's page for the page the card sat on, and a
 * [data-vt-card] for that page is on screen (the one nearest where the card
 * was tapped when several are); never under reduced motion, Save-Data,
 * presenting or an intro; and the listener only reads the event, never
 * stopping it or preventing its default.
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
import { BACK_WAIT_MS, readDebugSwitches } from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { EASE } from "@/lib/motion/tokens";
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

function place() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
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

/** Taps a card's main link, then its page comes in, as any forward change ends. */
function open(name: string | RegExp, href: string, page: ReactNode = toolPage()) {
  fireEvent.click(screen.getByRole("link", { name }));
  window.history.pushState(null, "", href);
  show(href, page);
}

/** A plain change to `href`, not from a card. */
function visit(href: string, page: ReactNode) {
  window.history.pushState(null, "", href);
  show(href, page);
}

/** What Next's own popstate listener does next: put the page back. */
let restore: (() => void) | null = null;
function nextRestores() {
  const run = restore;
  restore = null;
  run?.();
}

function popstate(hasUAVisualTransition?: unknown): PopStateEvent {
  const event = new PopStateEvent("popstate", { state: { __NA: true } });
  if (hasUAVisualTransition !== undefined) {
    Object.defineProperty(event, "hasUAVisualTransition", { value: hasUAVisualTransition });
  }
  return event;
}

/**
 * A history step to `href`: the address changes, popstate fires, Next's
 * listener puts `page` back inside the event, and the browser puts the scroll
 * back after it. Returns the event.
 */
function step(href: string, page: ReactNode, event: PopStateEvent = popstate(false)) {
  window.history.replaceState(null, "", href);
  restore = () => show(href, page);
  restored = false;
  window.dispatchEvent(event);
  restored = true;
  return event;
}

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const realRaf = window.requestAnimationFrame;
const realCancel = window.cancelAnimationFrame;

/** Runs the frame the browser paints next. */
function nextFrame() {
  const due = Array.from(frames.values());
  frames.clear();
  for (const callback of due) callback(performance.now());
}

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
  // Added before RouteSignal's: the slide must still read the leaving page first.
  window.addEventListener("popstate", nextRestores);
  window.addEventListener("click", stopBrowser);
  place();
  view = render(<App page={home()} />);
});

afterEach(async () => {
  skipViewTransition();
  await flush();
  cleanup();
  restore = null;
  window.removeEventListener("popstate", nextRestores);
  window.removeEventListener("click", stopBrowser);
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancel;
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
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
  it("from the leaving page's header, translate only, in 0.3 s on glide", () => {
    expect(RETURN_MS).toBe(300);
    open("Kanban", "/kanban");
    step("/", home());
    // Next put the home page back inside the event: the header is gone, so it
    // was measured before Next's listener ran, though that one was added first.
    expect(document.querySelector("header[data-vt-target]")).toBeNull();
    // Nothing yet: in the commit the browser had not put the scroll back.
    expect(slides()).toEqual([]);
    nextFrame();
    expectSlide("Kanban");
    // No fill, and nothing but translate: no clip, fade or scale.
    expect(slides()[0].options).not.toHaveProperty("fill");
    expect(Object.keys(slides()[0].keyframes[0])).toEqual(["translate"]);
  });

  it("once: a later frame or render does not slide it again", () => {
    open("Kanban", "/kanban");
    step("/", home());
    nextFrame();
    show("/", home());
    nextFrame();
    expect(slides()).toHaveLength(1);
  });

  it("each time Back returns to the card's page, after Forward too", () => {
    open("Kanban", "/kanban");
    step("/", home());
    nextFrame();
    step("/kanban", toolPage());
    nextFrame();
    expect(slides()).toHaveLength(1);
    step("/", home());
    nextFrame();
    expect(slides()).toHaveLength(2);
  });

  it("after the card's frame grew into the header through a view transition", async () => {
    const { made } = installViewTransitions();
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    expect(router.push).toHaveBeenCalledWith("/kanban", { scroll: true });
    window.history.pushState(null, "", "/kanban");
    show("/kanban", toolPage());
    await flush();
    made[0].endAnimation();
    await flush();
    step("/", home());
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
    step("/comics", gallery);
    nextFrame();
    expectSlide(/The quiet stand-up/);
  });

  it("when Next brings the page back after the event, within BACK_WAIT_MS", () => {
    let now = 50_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    open("Kanban", "/kanban");
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(popstate(false));
    now += BACK_WAIT_MS - 1;
    show("/", home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("from the top edge when the leaving page's header was scrolled out of sight", () => {
    open("Kanban", "/kanban");
    headerAt = { ...HEADER, top: -900 };
    step("/", home());
    nextFrame();
    expectSlide("Kanban", CARD, { left: HEADER.left, top: 0 });
  });

  it("when the card is only partly on screen", () => {
    open("Kanban", "/kanban");
    const low = { ...CARD, top: 700 };
    cardAt = () => low;
    step("/", home());
    nextFrame();
    expectSlide("Kanban", low);
  });
});

describe("hasUAVisualTransition must be exactly false", () => {
  it.each([
    ["true: the browser played its own Back (an iPhone's swipe)", true],
    ["missing: a browser without the field", undefined],
    ["anything else that is not false", 0],
  ])("%s", (_name, value) => {
    open("Kanban", "/kanban");
    step("/", home(), popstate(value));
    nextFrame();
    expect(slides()).toEqual([]);
  });
});

describe("the step must come back to the page the card was tapped on", () => {
  it("not on a step to another page", () => {
    open("Kanban", "/kanban");
    step("/retro", toolPage("Retro"));
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("only on the step from the card's page: a page in between does not count", () => {
    open("Kanban", "/kanban");
    visit("/retro", toolPage("Retro"));
    // Back to the card's page: not the page it sat on.
    step("/kanban", toolPage());
    nextFrame();
    expect(slides()).toEqual([]);
    // Then back again: from the card's page to the page it sat on.
    step("/", home());
    nextFrame();
    expectSlide("Kanban");
  });

  it("not when Back leaves another page for the card's old page", () => {
    open("Kanban", "/kanban");
    step("/", home());
    nextFrame();
    expect(slides()).toHaveLength(1);
    // A new page replaces the card's in history; Back from it is not the card's way back.
    visit("/retro", toolPage("Retro"));
    step("/", home());
    nextFrame();
    expect(slides()).toHaveLength(1);
  });

  it("not when a newer page commits before the frame", () => {
    open("Kanban", "/kanban");
    step("/", home());
    visit("/retro", toolPage("Retro"));
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when the page comes back later than BACK_WAIT_MS after Back", () => {
    let now = 50_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    open("Kanban", "/kanban");
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(popstate(false));
    now += BACK_WAIT_MS + 1;
    show("/", home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not for a link that only lends its spot: a related-tool tile is no card", () => {
    // A card tap first, so an earlier test's record is replaced.
    open("Retro", "/retro", toolPage("Retro"));
    step("/", home());
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
    step("/", withTile);
    nextFrame();
    // Only the Retro card's slide from before.
    expect(slides()).toHaveLength(1);
  });
});

describe("the card for that page must be on screen", () => {
  it("not when it is below the screen once the scroll is back", () => {
    open("Kanban", "/kanban");
    cardAt = () => ({ ...CARD, top: 1200 });
    step("/", home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("not when the page has no such card", () => {
    open("Kanban", "/kanban");
    step("/", home(retro));
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
    step("/", twice);
    nextFrame();
    expectSlide("Kanban board", { ...low, top: 410 });
  });

  it("of several, only those on screen count", () => {
    const top = { ...CARD, top: 100 };
    cardAt = (name) => (name === "Kanban" ? top : CARD);
    const twice = home(kanban(), kanban("Kanban board"));
    show("/", twice);
    open("Kanban board", "/kanban");
    // Back, the tapped card is below the screen; the other is in view.
    cardAt = (name) => (name === "Kanban" ? top : { ...CARD, top: 1300 });
    step("/", twice);
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
    step("/", page);
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
    step("/", home());
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("when the rule turns on between Back and the frame", () => {
    open("Kanban", "/kanban");
    step("/", home());
    root.dataset.presenting = "true";
    nextFrame();
    expect(slides()).toEqual([]);
  });

  it("where element.animate is missing", () => {
    open("Kanban", "/kanban");
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    step("/", home());
    expect(() => nextFrame()).not.toThrow();
    expect(card("Kanban").getAttribute("style")).toBeNull();
  });
});

describe("the popstate listener only reads", () => {
  it("never stops the event or prevents its default, and changes no page itself", () => {
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
      step("/", home(), event);
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

  it("goes when RouteSignal does", () => {
    open("Kanban", "/kanban");
    cleanup();
    // A header is still there to measure: only a listener left behind would note the step.
    const header = document.body.appendChild(document.createElement("header"));
    header.setAttribute("data-vt-target", "");
    try {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(popstate(false));
      view = render(<App page={home()} />);
      nextFrame();
      expect(slides()).toEqual([]);
    } finally {
      header.remove();
    }
  });
});
