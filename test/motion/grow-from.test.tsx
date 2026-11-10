/**
 * The header grow (lib/motion/grow-from.ts): when no view transition carried
 * a card's frame into the new page's header, the header grows out of the
 * card's spot, once, as one Web Animations movement (a translate and a
 * clip-path inset, no fill). element.animate is a stub here (jsdom has none),
 * and getBoundingClientRect places the card and the header.
 *
 * It plays for a card whose change ran no transition: no view transitions in
 * the browser, ?vt=off, a page that missed the hold, a comic card
 * (prefetch={false}), a card to a force-dynamic page and a related-tool tile
 * (frame="spot"). It never plays under reduced motion, Save-Data, presenting
 * or an intro, after 1.5 s, on another page, or when the frame landed. It
 * starts from the wrapper's layout effect, after Next's scroll in the same
 * commit and before the commit's passive effects, without waiting for a frame.
 */
import { startTransition, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
  }),
}));

import { ToolCard } from "@/components/shared/tool-card";
import { ComicCard } from "@/app/(tools)/comics/components/comic-card";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { growFrom } from "@/lib/motion/grow-from";
import {
  GROW_WINDOW_MS,
  HOLD_CAP_MS,
  arrivalRecord,
  notifyRouteCommitted,
  readDebugSwitches,
  registerNavigator,
} from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { DUR, EASE } from "@/lib/motion/tokens";
import { comicHref } from "@/lib/comics/entry";
import type { StorySummary } from "@/lib/comics/types";
import { flush, installViewTransitions, removeViewTransitions } from "./fake-view-transitions";

const root = document.documentElement;

const CARD = { left: 16, top: 400, width: 343, height: 180 };
const HEADER = { left: 12, top: 80, width: 351, height: 120 };

function box(b: typeof CARD): DOMRect {
  return {
    ...b,
    x: b.left,
    y: b.top,
    right: b.left + b.width,
    bottom: b.top + b.height,
    toJSON: () => b,
  } as DOMRect;
}

/** Cards and tiles sit at CARD; the new page's header at HEADER. */
function placeElements() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches("header[data-vt-target]")) return box(HEADER);
    return box(CARD);
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

/** Reports the page from a layout effect, first in the tree, as RouteSignal does. */
function Signal({ href }: { href: string }) {
  useLayoutEffect(() => notifyRouteCommitted(href), [href]);
  return null;
}

function App({ href, page }: { href: string; page: ReactNode }) {
  return (
    <>
      <Signal href={href} />
      {page}
    </>
  );
}

const toolPage = (title = "Kanban Board") => (
  <ToolPageWrapper title={title} description="Visualise work" showInsights={false}>
    <p>Board</p>
  </ToolPageWrapper>
);

let animate = vi.fn();
let nav = { push: vi.fn(), replace: vi.fn() };
let unregister = () => {};

function stopBrowser(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  animate = vi.fn(() => ({ finished: Promise.resolve() }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  nav = { push: vi.fn(), replace: vi.fn() };
  unregister = registerNavigator(nav);
  window.addEventListener("click", stopBrowser);
  placeElements();
});

afterEach(async () => {
  skipViewTransition();
  notifyRouteCommitted("/__test-end");
  await flush();
  cleanup();
  unregister();
  window.removeEventListener("click", stopBrowser);
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeViewTransitions();
  delete root.dataset.intro;
  delete root.dataset.presenting;
  delete (navigator as { connection?: unknown }).connection;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  readDebugSwitches();
});

/** A quick page, well inside the hold. */
const QUICK_MS = 40;

/**
 * Taps `name` on the old page, then puts `page` in place at `href`, `lateBy`
 * ms after the tap. performance.now() is pinned for the whole step, so the
 * grow window is measured on this clock and a slow test run never moves the
 * arrival past it.
 */
async function tapThenArrive(
  oldPage: ReactNode,
  name: string | RegExp,
  href: string,
  page: ReactNode = toolPage(),
  lateBy = QUICK_MS
) {
  let now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const { rerender } = render(<App href="/" page={oldPage} />);
  fireEvent.click(screen.getAllByRole("link", { name })[0]);
  await flush();
  now += lateBy;
  window.history.replaceState(null, "", href);
  rerender(<App href={href} page={page} />);
  await flush();
}

const kanbanCard = <ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />;

function header(): HTMLElement {
  return document.querySelector("header[data-vt-target]") as HTMLElement;
}

/** The one grow, on the header, from CARD to HEADER. */
function expectOneGrow() {
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.contexts[0]).toBe(header());
  const [keyframes, options] = animate.mock.calls[0];
  expect(keyframes).toEqual([
    {
      translate: `${CARD.left - HEADER.left}px ${CARD.top - HEADER.top}px`,
      clipPath: `inset(-8px ${HEADER.width - CARD.width}px 0px -8px)`,
    },
    { translate: "0px 0px", clipPath: "inset(-8px -8px -8px -8px)" },
  ]);
  expect(options).toEqual({ duration: DUR.travel, easing: EASE.glide });
  // No fill: nothing is held on the header once it ends.
  expect(options).not.toHaveProperty("fill");
}

describe("the header grows from the card's spot", () => {
  it("when the browser has no view transitions", async () => {
    await tapThenArrive(kanbanCard, "Kanban", "/kanban");
    expectOneGrow();
  });

  it("with ?vt=off, as on Safari 17", async () => {
    installViewTransitions();
    window.history.replaceState(null, "", "/?vt=off");
    readDebugSwitches();
    await tapThenArrive(kanbanCard, "Kanban", "/kanban");
    expectOneGrow();
  });

  it("when the page missed the hold, and the page rises too", async () => {
    // performance is faked too, so the grow window sees the late arrival.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    installViewTransitions();
    const { rerender } = render(<App href="/" page={kanbanCard} />);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS);
    // A page that took 600 ms: well past the cap, well inside the window.
    await vi.advanceTimersByTimeAsync(600 - HOLD_CAP_MS);
    expect(performance.now() - arrivalRecord()!.at).toBe(600);
    window.history.replaceState(null, "", "/kanban");
    rerender(<App href="/kanban" page={toolPage()} />);
    await flush();
    expectOneGrow();
    expect(header().parentElement).toHaveClass("motion-safe:animate-rise");
  });

  it("up to GROW_WINDOW_MS after the tap", async () => {
    await tapThenArrive(kanbanCard, "Kanban", "/kanban", toolPage(), GROW_WINDOW_MS - 1);
    expectOneGrow();
  });

  it("for a comic card, whose link does not load ahead", async () => {
    await tapThenArrive(
      <ul>
        <ComicCard story={STORY} />
      </ul>,
      /The quiet stand-up/,
      comicHref(30),
      toolPage("The quiet stand-up")
    );
    expectOneGrow();
  });

  it("for a card to a force-dynamic page", async () => {
    installViewTransitions();
    await tapThenArrive(
      <ToolCard href="/which-colleague" icon={null} title="Which colleague" description="Quiz" />,
      "Which colleague",
      "/which-colleague",
      toolPage("Which colleague")
    );
    expectOneGrow();
  });

  it("for a related-tool tile (frame='spot'), which runs no transition", async () => {
    const { start } = installViewTransitions();
    render(<RelatedTools toolId="wsjf" />);
    const href = screen.getAllByRole("link")[0].getAttribute("href")!;
    cleanup();
    // The first link on the old page is that first tile.
    await tapThenArrive(<RelatedTools toolId="wsjf" />, /./, href);
    expect(start).not.toHaveBeenCalled();
    expectOneGrow();
  });

  it("once: a later render, or another header mounting, does not grow it again", async () => {
    await tapThenArrive(kanbanCard, "Kanban", "/kanban");
    expectOneGrow();
    render(toolPage("Another"));
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("without waiting for a frame: requestAnimationFrame never fires", async () => {
    const raf = vi.fn(() => 0);
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = raf;
    onTestFinished(() => {
      window.requestAnimationFrame = realRaf;
    });
    await tapThenArrive(kanbanCard, "Kanban", "/kanban");
    expectOneGrow();
    expect(raf).not.toHaveBeenCalled();
  });

  it("from the layout effect: it has played before the commit's passive effects run", async () => {
    // The page arrives as Next renders it, in a transition on React's own
    // scheduler, outside act(): act() runs passive effects before any
    // microtask, which would hide a grow started from useEffect.
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { unmount } = render(<App href="/" page={kanbanCard} />);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    unmount();

    // A parent's layout effect runs after the wrapper's in the same commit,
    // so the microtask it queues runs after the one the wrapper queued. It
    // also makes the commit "take" 20 ms on the pinned clock, past the
    // scheduler's 5 ms slice, so the scheduler yields before the passive
    // effects, as it can in the browser, where a paint may come first.
    const seen: { grows: number; passiveRan: boolean }[] = [];
    let passiveRan = false;
    function Probe({ children }: { children: ReactNode }) {
      useLayoutEffect(() => {
        now += 20;
        queueMicrotask(() => seen.push({ grows: animate.mock.calls.length, passiveRan }));
      }, []);
      useEffect(() => {
        passiveRan = true;
      }, []);
      return <>{children}</>;
    }

    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasActEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.body.appendChild(document.createElement("div"));
    const reactRoot = createRoot(host);
    try {
      window.history.replaceState(null, "", "/kanban");
      startTransition(() => {
        reactRoot.render(<App href="/kanban" page={<Probe>{toolPage()}</Probe>} />);
      });
      await vi.waitFor(() => expect(passiveRan).toBe(true));
      // The first microtask after the commit: the grow had played, and the
      // passive effects were still to come, so this checked the order.
      expect(seen).toEqual([{ grows: 1, passiveRan: false }]);
      expectOneGrow();
    } finally {
      reactRoot.unmount();
      host.remove();
      env.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
    }
  });

  it("after the commit's own scroll: it measures the header where it ends up", async () => {
    // Next's scroll handler wraps the page, so its layout work runs after the
    // wrapper's effect. This one moves the header the same way, after it.
    let moved = false;
    function LateScroll({ children }: { children: ReactNode }) {
      useLayoutEffect(() => {
        moved = true;
      }, []);
      return <>{children}</>;
    }
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      if (this.matches("header[data-vt-target]")) {
        return box(moved ? HEADER : { ...HEADER, top: HEADER.top - 1500 });
      }
      return box(CARD);
    });
    await tapThenArrive(kanbanCard, "Kanban", "/kanban", <LateScroll>{toolPage()}</LateScroll>);
    expectOneGrow();
  });

  it("leaves no inline style or transform on the header or the wrapper", async () => {
    await tapThenArrive(kanbanCard, "Kanban", "/kanban");
    expectOneGrow();
    const wrapper = header().parentElement!;
    for (const el of [header(), wrapper]) {
      expect(el.getAttribute("style")).toBeNull();
      expect(el.style.transform).toBe("");
      expect(el.style.translate).toBe("");
      expect(el.style.clipPath).toBe("");
    }
  });
});

describe("the header does not grow", () => {
  it("when the card's frame landed on it through a view transition", async () => {
    const { made } = installViewTransitions();
    const { rerender } = render(<App href="/" page={kanbanCard} />);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    window.history.replaceState(null, "", "/kanban");
    rerender(<App href="/kanban" page={toolPage()} />);
    await flush();
    expect(header()).toHaveAttribute("data-vt-active");
    // The header used the record up and grew nothing: the frame was its entrance.
    expect(arrivalRecord()).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    made[0].endAnimation();
    await flush();
    expect(animate).not.toHaveBeenCalled();
  });

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
  ])("%s", async (_name, arrange) => {
    arrange();
    await tapThenArrive(kanbanCard, "Kanban", "/kanban");
    expect(header()).not.toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("after GROW_WINDOW_MS (1.5 s)", async () => {
    expect(GROW_WINDOW_MS).toBe(1500);
    await tapThenArrive(kanbanCard, "Kanban", "/kanban", toolPage(), GROW_WINDOW_MS + 1);
    expect(animate).not.toHaveBeenCalled();
    expect(arrivalRecord()).toBeNull();
  });

  it("on another page than the card's (a later plain change)", async () => {
    await tapThenArrive(kanbanCard, "Kanban", "/retro");
    expect(animate).not.toHaveBeenCalled();
    // Still kept for the card's own page, within the window.
    expect(arrivalRecord()).toMatchObject({ to: "/kanban" });
  });

  it("when element.animate is missing", async () => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    await expect(tapThenArrive(kanbanCard, "Kanban", "/kanban")).resolves.toBeUndefined();
    expect(header()).not.toBeNull();
    expect(header().getAttribute("style")).toBeNull();
  });
});

describe("growFrom", () => {
  const el = () => {
    const h = document.createElement("header");
    h.setAttribute("data-vt-target", "");
    document.body.append(h);
    return h;
  };

  it("eases on glide, a cubic-bezier, never a linear() list that older engines refuse", () => {
    expect(EASE.glide).toMatch(/^cubic-bezier\(/);
    growFrom(el(), CARD);
    expect(animate.mock.calls[0][1].easing).toBe(EASE.glide);
  });

  it("shows all of the header from the start when the card is larger", () => {
    growFrom(el(), { left: 0, top: 300, width: 400, height: 500 });
    expect(animate.mock.calls[0][0][0].clipPath).toBe("inset(-8px 0px 0px -8px)");
  });

  it("plays nothing for an empty card or header", () => {
    expect(growFrom(el(), { ...CARD, width: 0 })).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });
});
