/**
 * A card's frame grows into the new page's header (lib/motion/page-transition.ts).
 * The browser's start function is a fake (fake-view-transitions.ts). The new
 * page arrives the way it does in the app: a Signal component stands in for
 * RouteSignal, first in the tree, and reports the page from its layout
 * effect in the commit that puts the page in place.
 *
 * What must hold: exactly one element carries the mark (and so the name) in
 * each picture, the card in the old one and the header in the new one, since
 * two would make the browser skip the whole change; a link that is not a
 * card's marks nothing; a page with no header gives the exit; an intro on the
 * new page skips; links that do not load ahead and related-tool tiles start no
 * transition but leave an arrival record; nothing is left behind; and the
 * frame asks the router for no prefetch of its own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

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
import { JobLauncher } from "@/components/home/job-launcher";
import { ComicCard } from "@/app/(tools)/comics/components/comic-card";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import TransitionLink from "@/components/motion/transition-link";
import { comicHref } from "@/lib/comics/entry";
import type { StorySummary } from "@/lib/comics/types";
import {
  HOLD_CAP_MS,
  arrivalRecord,
  isFrameLanding,
  notifyRouteCommitted,
  pageChangeLog,
  registerNavigator,
} from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { flush, installViewTransitions, removeViewTransitions } from "./fake-view-transitions";

const ROOT = path.resolve(__dirname, "../..");
const root = document.documentElement;

/** Reports the page from a layout effect, first in the tree, as RouteSignal does in the shell. */
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

interface Picture {
  active: Element[];
  frame: string | null;
}

function picture(): Picture {
  return {
    active: Array.from(document.querySelectorAll("[data-vt-active]")),
    frame: root.getAttribute("data-vt-frame"),
  };
}

/** The fake start function, recording what carries the mark when the old picture is taken. */
function installWatched() {
  const vt = installViewTransitions();
  const old: Picture[] = [];
  const real = vt.start.getMockImplementation()!;
  vt.start.mockImplementation((update: () => Promise<void>) => {
    old.push(picture());
    return real(update);
  });
  return { ...vt, old };
}

const ATTRS = ["data-vt", "data-vt-frame", "data-vt-active"];
function leftovers(): string[] {
  return ATTRS.filter((a) => root.hasAttribute(a) || document.querySelector(`[${a}]`) !== null);
}

const last = () => pageChangeLog()[pageChangeLog().length - 1];

/** A fixed box for an element, as getBoundingClientRect reports it. */
function placeAt(el: Element, box: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  } as DOMRect);
}

let nav = { push: vi.fn(), replace: vi.fn() };
let unregister = () => {};

/** Stops jsdom's own navigation for a click left to the browser. */
function stopBrowser(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  nav = { push: vi.fn(), replace: vi.fn() };
  unregister = registerNavigator(nav);
  window.addEventListener("click", stopBrowser);
});

afterEach(async () => {
  skipViewTransition();
  notifyRouteCommitted("/__test-end");
  await flush();
  cleanup();
  unregister();
  window.removeEventListener("click", stopBrowser);
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeViewTransitions();
  delete root.dataset.intro;
  window.history.replaceState(null, "", "/");
});

/** Puts the new page in place at `href`, as the router does: address first, then the commit. */
function arrive(rerender: (ui: ReactNode) => void, href: string, page: ReactNode) {
  window.history.replaceState(null, "", href);
  rerender(<App href={href} page={page} />);
}

describe("a tool card's frame", () => {
  it("is on exactly one element in each picture: the card, then the header", async () => {
    const { start, made, old } = installWatched();
    const { rerender } = render(
      <App
        href="/"
        page={<ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />}
      />
    );
    const card = document.querySelector("[data-vt-card]")!;
    placeAt(card, { left: 16, top: 400, width: 343, height: 180 });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(old).toEqual([{ active: [card], frame: "exit" }]);
    expect(isFrameLanding()).toBe(true);

    await flush();
    expect(nav.push).toHaveBeenCalledWith("/kanban", { scroll: true });
    let atNew: Picture | null = null;
    void made[0].updateDone.then(() => (atNew = picture()));
    arrive(rerender, "/kanban", toolPage());
    // In the commit: the frame took the header, so the record says so.
    expect(arrivalRecord()).toMatchObject({
      to: "/kanban",
      spot: { left: 16, top: 400, width: 343, height: 180 },
      viewTransition: true,
    });
    await flush();

    const header = document.querySelector("header[data-vt-target]")!;
    expect(header).not.toBeNull();
    expect(atNew).toEqual({ active: [header], frame: "pair" });

    made[0].endAnimation();
    await flush();
    expect(last()).toMatchObject({ href: "/kanban", outcome: "ran" });
    expect(leftovers()).toEqual([]);
    expect(isFrameLanding()).toBe(false);
  });

  it("marks the first header only, when the new page has two", async () => {
    const { made } = installWatched();
    const { rerender } = render(
      <App
        href="/"
        page={<ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />}
      />
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    let atNew: Picture | null = null;
    void made[0].updateDone.then(() => (atNew = picture()));
    arrive(
      rerender,
      "/kanban",
      <>
        {toolPage("First")}
        {toolPage("Second")}
      </>
    );
    await flush();
    const [first] = Array.from(document.querySelectorAll("header[data-vt-target]"));
    expect(atNew).toEqual({ active: [first], frame: "pair" });
  });

  it("exits when the new page has no header: only the old picture has the frame", async () => {
    const { made, old } = installWatched();
    const { rerender } = render(
      <App
        href="/"
        page={<ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />}
      />
    );
    const card = document.querySelector("[data-vt-card]")!;
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(old).toEqual([{ active: [card], frame: "exit" }]);
    await flush();
    let atNew: Picture | null = null;
    void made[0].updateDone.then(() => (atNew = picture()));
    arrive(rerender, "/kanban", <p>No header here</p>);
    await flush();
    expect(atNew).toEqual({ active: [], frame: "exit" });
    // No view transition took a header, so a late one may still grow.
    expect(arrivalRecord()).toMatchObject({ to: "/kanban", viewTransition: false });
    made[0].endAnimation();
    await flush();
    expect(leftovers()).toEqual([]);
  });

  it("skips the change when an intro takes the stage on the new page", async () => {
    const { made } = installWatched();
    const { rerender } = render(
      <App
        href="/"
        page={<ToolCard href="/comics" icon={null} title="Comics" description="Read" />}
      />
    );
    fireEvent.click(screen.getByRole("link", { name: "Comics" }));
    await flush();
    root.dataset.intro = "book";
    arrive(rerender, "/comics", toolPage("Comics"));
    expect(made[0].skipTransition).toHaveBeenCalled();
    expect(arrivalRecord()).toMatchObject({ viewTransition: false });
    await flush();
    expect(leftovers()).toEqual([]);
    expect(isFrameLanding()).toBe(false);
    expect(last()).toMatchObject({ href: "/comics", outcome: "fallback" });
  });
});

describe("a home job card", () => {
  it("lends its li to the frame from its main link", () => {
    const { old } = installWatched();
    const { container } = render(<JobLauncher />);
    const first = container.querySelector("li[data-vt-card]")!;
    const main = within(first.querySelector("h3")!).getByRole("link");
    fireEvent.click(main);
    expect(old).toEqual([{ active: [first], frame: "exit" }]);
  });

  it("marks nothing for an Other options link, which only cross-fades", () => {
    const { start, old } = installWatched();
    const { container } = render(<JobLauncher />);
    const option = within(container.querySelector("details")!).getAllByRole("link")[0];
    fireEvent.click(option);
    expect(start).toHaveBeenCalledTimes(1);
    expect(old).toEqual([{ active: [], frame: null }]);
    expect(arrivalRecord()).toBeNull();
  });
});

describe("links that start no transition but leave an arrival record", () => {
  it("a comic card (prefetch={false}): the story's header grows from its spot", () => {
    const { start } = installWatched();
    render(
      <ul>
        <ComicCard story={STORY} />
      </ul>
    );
    const card = document.querySelector("[data-vt-card]")!;
    placeAt(card, { left: 12, top: 300, width: 351, height: 420 });
    const before = performance.now();
    fireEvent.click(screen.getByRole("link", { name: /The quiet stand-up/ }));
    expect(start).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
    const record = arrivalRecord()!;
    expect(record).toMatchObject({
      to: comicHref(30),
      spot: { left: 12, top: 300, width: 351, height: 420 },
      viewTransition: false,
    });
    expect(record.at).toBeGreaterThanOrEqual(before);
    expect(last()).toMatchObject({ outcome: "instant", why: "not-ahead" });
  });

  it("a related-tool tile (frame='spot') names no frame, starts nothing and keeps its spot", () => {
    const { start } = installWatched();
    render(<RelatedTools toolId="wsjf" />);
    const tile = screen.getAllByRole("link")[0];
    placeAt(tile, { left: 16, top: 900, width: 343, height: 72 });
    fireEvent.click(tile);
    expect(start).not.toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
    expect(arrivalRecord()).toMatchObject({
      to: tile.getAttribute("href"),
      spot: { left: 16, top: 900, width: 343, height: 72 },
      viewTransition: false,
    });
    expect(last()).toMatchObject({ outcome: "instant", why: "spot" });
  });

  it("the tiles still load ahead: no prefetch={false} on them", () => {
    const src = readFileSync(
      path.join(ROOT, "src/components/tool-frame/related-tools.tsx"),
      "utf8"
    );
    expect(src).toContain('frame="spot"');
    expect(src).not.toMatch(/prefetch=\{false\}/);
  });

  it("a card to a force-dynamic page", () => {
    const { start } = installWatched();
    render(
      <ToolCard href="/which-colleague" icon={null} title="Which colleague" description="Quiz" />
    );
    fireEvent.click(screen.getByRole("link", { name: "Which colleague" }));
    expect(start).not.toHaveBeenCalled();
    expect(arrivalRecord()).toMatchObject({ to: "/which-colleague", viewTransition: false });
  });

  it("any other link drops an earlier card's record", () => {
    installWatched();
    render(
      <>
        <ToolCard href="/which-colleague" icon={null} title="Which colleague" description="Quiz" />
        <TransitionLink href="/retro" prefetch={false}>
          Retro
        </TransitionLink>
      </>
    );
    fireEvent.click(screen.getByRole("link", { name: "Which colleague" }));
    expect(arrivalRecord()).not.toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(arrivalRecord()).toBeNull();
  });
});

describe("clean-up", () => {
  function tapCard() {
    const vt = installWatched();
    render(<ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(document.querySelectorAll("[data-vt-active]")).toHaveLength(1);
    return vt;
  }

  it("leaves nothing and clears the landing flag after a skip", async () => {
    tapCard();
    await flush();
    skipViewTransition();
    await flush();
    expect(leftovers()).toEqual([]);
    expect(isFrameLanding()).toBe(false);
    expect(arrivalRecord()).toMatchObject({ viewTransition: false });
  });

  it("clears the landing flag at the cap, before the late page renders", async () => {
    vi.useFakeTimers();
    tapCard();
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS - 1);
    expect(isFrameLanding()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(isFrameLanding()).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(last()).toMatchObject({ outcome: "capped" });
    // The late page finds no frame to land: its header grows from the spot.
    notifyRouteCommitted("/kanban");
    await vi.advanceTimersByTimeAsync(0);
    expect(leftovers()).toEqual([]);
    expect(arrivalRecord()).toMatchObject({ to: "/kanban", viewTransition: false });
  });

  it("a second tap takes the first card's mark away and changes the page plainly", async () => {
    const { start } = installWatched();
    render(
      <>
        <ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />
        <ToolCard href="/retro" icon={null} title="Retro" description="Look back" />
      </>
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(leftovers()).toEqual([]);
    expect(arrivalRecord()).toMatchObject({ to: "/retro", viewTransition: false });
    expect(nav.push.mock.calls.map((c) => c[0])).toEqual(["/kanban", "/retro"]);
  });

  it("frames nothing when the browser refuses to start one", () => {
    const { start } = installWatched();
    start.mockImplementation(() => {
      throw new Error("refused");
    });
    render(<ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(leftovers()).toEqual([]);
    expect(isFrameLanding()).toBe(false);
    expect(nav.push).toHaveBeenCalledWith("/kanban", { scroll: true });
  });
});

describe("loading ahead", () => {
  function appRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    };
  }

  /** The router.prefetch calls a pointer-down, a touch and a click on `link` make. */
  function prefetchCalls(ui: ReactNode, name: string): unknown[][] {
    const router = appRouter();
    render(<AppRouterContext.Provider value={router}>{ui}</AppRouterContext.Provider>);
    const link = screen.getByRole("link", { name });
    fireEvent.pointerDown(link);
    fireEvent.touchStart(link);
    fireEvent.click(link);
    cleanup();
    return router.prefetch.mock.calls;
  }

  it("asks the router for nothing a plain next/link would not on pointer-down, touch or click", () => {
    installWatched();
    const plain = prefetchCalls(<Link href="/kanban">Kanban</Link>, "Kanban");
    const framed = prefetchCalls(
      <ToolCard href="/kanban" icon={null} title="Kanban" description="Flow" />,
      "Kanban"
    );
    // Something to compare: two empty lists would pass and check nothing.
    expect(plain.length).toBeGreaterThan(0);
    expect(framed).toEqual(plain);
    // next/link's own touch prefetch reuses its in-view copy: kind auto, never full.
    for (const [, options] of framed) expect(options).toEqual({ kind: "auto" });
  });

  it("has no prefetch call of its own in the link", () => {
    const src = readFileSync(path.join(ROOT, "src/components/motion/transition-link.tsx"), "utf8");
    // A call, not the prop it passes on: router.prefetch(...) or prefetch?.(...).
    expect(src).not.toMatch(/\bprefetch\??\.?\s*\(/);
    expect(src).not.toMatch(/on(PointerDown|TouchStart|MouseDown)\b/);
  });
});
