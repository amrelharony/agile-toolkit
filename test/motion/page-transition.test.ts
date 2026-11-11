/**
 * Page changes: when one may move (one row per rule), the hold cap, the
 * clean-up, a second tap, the measuring and the two debug switches. The
 * browser's start function is a fake (fake-view-transitions.ts) and the
 * router a stub that the test answers with notifyRouteCommitted, as
 * RouteSignal does from its layout effect.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  DYNAMIC_PATHS,
  HOLD_CAP_MS,
  afterPageTransition,
  fallbackNavigation,
  isPageTransitionRunning,
  notifyRouteCommitted,
  pageChangeLog,
  pushWithTransition,
  readDebugSwitches,
  registerNavigator,
  type PageChangeOptions,
} from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { flush, installViewTransitions, removeViewTransitions } from "./fake-view-transitions";

const ROOT = path.resolve(__dirname, "../..");
const root = document.documentElement;

/** The shell's own list, read from app-shell.tsx (importing it would load the whole shell). */
const BARE_ROUTE_PREFIXES = (() => {
  const shell = readFileSync(path.join(ROOT, "src/components/layout/app-shell.tsx"), "utf8");
  const list = /export const BARE_ROUTE_PREFIXES = \[([^\]]*)\]/.exec(shell);
  expect(list, "app-shell.tsx exports BARE_ROUTE_PREFIXES").not.toBeNull();
  return Array.from(list![1].matchAll(/"([^"]+)"/g), (m) => m[1]);
})();
const isBare = (p: string) => BARE_ROUTE_PREFIXES.some((b) => p === b || p.startsWith(`${b}/`));

function stubRouter() {
  return { push: vi.fn(), replace: vi.fn() };
}

let router = stubRouter();
let unregister = () => {};

function goTo(address: string) {
  window.history.replaceState(null, "", address);
}

const last = () => pageChangeLog()[pageChangeLog().length - 1];

const ATTRS = ["data-vt", "data-vt-frame", "data-vt-active"];
function leftovers(): string[] {
  return ATTRS.filter((a) => root.hasAttribute(a) || document.querySelector(`[${a}]`) !== null);
}

beforeEach(() => {
  goTo("/");
  router = stubRouter();
  unregister = registerNavigator(router, isBare);
});

afterEach(async () => {
  skipViewTransition();
  // Ends any change still waiting for its page, so it settles in its own test.
  notifyRouteCommitted("/__test-end");
  await flush();
  unregister();
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeViewTransitions();
  delete root.dataset.presenting;
  delete root.dataset.intro;
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (navigator as { connection?: unknown }).connection;
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  goTo("/");
  readDebugSwitches();
});

/** A link inside `wrapper`, for the zone rules. */
function linkIn(wrapper: string): HTMLAnchorElement {
  document.body.innerHTML = `${wrapper.replace("></", '><a href="/kanban">Kanban</a></')}`;
  return document.querySelector("a")!;
}

function setConnection(value: object) {
  Object.defineProperty(navigator, "connection", { configurable: true, value });
}

describe("when a page change stays instant", () => {
  const rows: [string, () => void, string, PageChangeOptions, string][] = [
    [
      "the browser has no view transitions",
      () => removeViewTransitions(),
      "/kanban",
      {},
      "unavailable",
    ],
    [
      "the --vt-ready marker is missing",
      () => root.style.removeProperty("--vt-ready"),
      "/kanban",
      {},
      "unavailable",
    ],
    ["no router is registered", () => unregister(), "/kanban", {}, "no-router"],
    [
      "under reduced motion",
      () =>
        vi
          .spyOn(window, "matchMedia")
          .mockImplementation(
            (query: string) =>
              ({ matches: query === "(prefers-reduced-motion: reduce)", media: query }) as never
          ),
      "/kanban",
      {},
      "unavailable",
    ],
    ["with Save-Data on", () => setConnection({ saveData: true }), "/kanban", {}, "save-data"],
    ["on 2G", () => setConnection({ effectiveType: "2g" }), "/kanban", {}, "save-data"],
    ["on slow 2G", () => setConnection({ effectiveType: "slow-2g" }), "/kanban", {}, "save-data"],
    ["with an intro on stage", () => (root.dataset.intro = "book"), "/kanban", {}, "unavailable"],
    ["while presenting", () => (root.dataset.presenting = "true"), "/kanban", {}, "unavailable"],
    [
      "in a hidden tab",
      () =>
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        }),
      "/kanban",
      {},
      "unavailable",
    ],
    ["to a bare route", () => {}, "/guest/join", {}, "bare"],
    ["from a bare route", () => goTo("/auth/sign-in"), "/kanban", {}, "bare"],
    ["for a link off the site", () => {}, "https://example.com/kanban", {}, "external"],
    ["for a mail link", () => {}, "mailto:team@example.com", {}, "external"],
    [
      "for the same path and query",
      () => goTo("/kanban?board=a"),
      "/kanban?board=a",
      {},
      "same-page",
    ],
    ["for a hash on the same page", () => goTo("/kanban"), "/kanban#notes", {}, "same-page"],
    ["for a link that does not load ahead", () => {}, "/kanban", { prefetch: false }, "not-ahead"],
    ...DYNAMIC_PATHS.map(
      (p) =>
        [`to the force-dynamic ${p}`, () => {}, p, {}, "dynamic"] as [
          string,
          () => void,
          string,
          PageChangeOptions,
          string,
        ]
    ),
    ["with ?vt=off", () => (goTo("/?vt=off"), readDebugSwitches()), "/kanban", {}, "vt-off"],
  ];

  it.each(rows)("%s", (_name, arrange, href, options, why) => {
    const { start } = installViewTransitions();
    arrange();
    expect(pushWithTransition(href, options)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ href, outcome: "instant", why, waited: 0 });
    expect(leftovers()).toEqual([]);
  });

  it("for a link in a dialog", () => {
    const { start } = installViewTransitions();
    const source = linkIn('<div role="dialog"></div>');
    expect(pushWithTransition("/kanban", { source })).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ outcome: "instant", why: "zone" });
  });

  it("for a link in a data-vt-instant zone (the open phone menu)", () => {
    const { start } = installViewTransitions();
    const source = linkIn('<aside data-vt-instant=""><nav></nav></aside>');
    expect(pushWithTransition("/kanban", { source })).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ outcome: "instant", why: "zone" });
  });

  it("changes the page through `plain` when one is given", () => {
    installViewTransitions();
    const plain = stubRouter();
    expect(pushWithTransition("/kanban", { prefetch: false, plain })).toBe(true);
    expect(plain.push).toHaveBeenCalledWith("/kanban", { scroll: true });
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("when a page change may move", () => {
  async function runs(from: string, href: string, options: PageChangeOptions = {}) {
    const { start, made } = installViewTransitions();
    goTo(from);
    expect(pushWithTransition(href, options)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(made[0].vtAtCapture).toBe("page");
    await flush();
    expect(router.push).toHaveBeenCalledWith(href, { scroll: true });
    notifyRouteCommitted(href);
    await flush();
    made[0].endAnimation();
    await flush();
    expect(last()).toMatchObject({ href, outcome: "ran" });
    expect(leftovers()).toEqual([]);
  }

  it("from home to a tool", () => runs("/", "/kanban"));
  it("on and from ceremony routes (quiet routes are allowed)", () =>
    runs("/retro", "/planning-poker"));
  it("from /comics to /comics?ep=30 (a new query is a new page)", () =>
    runs("/comics", "/comics?ep=30"));
  it("for a link that loads the full page ahead", () => runs("/", "/kanban", { prefetch: true }));
  it("replaces when asked, and keeps scroll off when asked", async () => {
    const { made } = installViewTransitions();
    expect(pushWithTransition("/kanban", { replace: true, scroll: false })).toBe(true);
    await flush();
    expect(router.replace).toHaveBeenCalledWith("/kanban", { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
    notifyRouteCommitted("/kanban");
    await flush();
    made[0].endAnimation();
    await flush();
  });

  it("ends the hold when a redirect lands on another page", async () => {
    const { made } = installViewTransitions();
    pushWithTransition("/old-tool");
    await flush();
    notifyRouteCommitted("/new-tool");
    await flush();
    expect(made[0].skipTransition).not.toHaveBeenCalled();
    made[0].endAnimation();
    await flush();
    expect(last()).toMatchObject({ outcome: "ran" });
  });

  it("is not ended by a report of the page it left", async () => {
    vi.useFakeTimers();
    const { made } = installViewTransitions();
    goTo("/retro");
    pushWithTransition("/kanban");
    await flush();
    notifyRouteCommitted("/retro");
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS);
    expect(made[0].skipTransition).toHaveBeenCalled();
    expect(last()).toMatchObject({ outcome: "capped" });
  });
});

describe("the hold", () => {
  it("is capped at the approved 150 ms", () => {
    expect(HOLD_CAP_MS).toBe(150);
  });

  it("skips at the cap when the page never arrives, frees the screen, and still changes the page", async () => {
    vi.useFakeTimers();
    const { made } = installViewTransitions();
    expect(pushWithTransition("/kanban")).toBe(true);
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS - 1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(made[0].skipTransition).not.toHaveBeenCalled();
    expect(root.getAttribute("data-vt")).toBe("page");
    expect(isPageTransitionRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    expect(leftovers()).toEqual([]);
    expect(isPageTransitionRunning()).toBe(false);
    expect(last()).toMatchObject({ href: "/kanban", outcome: "capped", waited: HOLD_CAP_MS });
    // The push already went out: the page changes plainly when it comes.
    expect(router.push).toHaveBeenCalledTimes(1);
    notifyRouteCommitted("/kanban");
    await vi.advanceTimersByTimeAsync(0);
    expect(leftovers()).toEqual([]);
  });

  it("waits for no frame: with requestAnimationFrame never firing, a page at 50 ms ends the hold at 50 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    const raf = vi.fn(() => 0);
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = raf;
    onTestFinished(() => {
      window.requestAnimationFrame = realRaf;
    });
    const { made } = installViewTransitions();
    router.push.mockImplementation((href: string) => {
      setTimeout(() => notifyRouteCommitted(href), 50);
    });
    let updateDone = false;
    pushWithTransition("/kanban");
    void made[0].updateDone.then(() => (updateDone = true));
    await vi.advanceTimersByTimeAsync(49);
    expect(updateDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(updateDone).toBe(true);
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS);
    expect(made[0].skipTransition).not.toHaveBeenCalled();
    made[0].endAnimation();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ outcome: "ran", waited: 50 });
    expect(raf).not.toHaveBeenCalled();
  });
});

describe("clean-up", () => {
  it("leaves nothing after a change that ran", async () => {
    const { made } = installViewTransitions();
    pushWithTransition("/kanban");
    await flush();
    expect(root.getAttribute("data-vt")).toBe("page");
    notifyRouteCommitted("/kanban");
    await flush();
    made[0].endAnimation();
    await flush();
    expect(leftovers()).toEqual([]);
  });

  it("leaves nothing after a skip", async () => {
    installViewTransitions();
    pushWithTransition("/kanban");
    await flush();
    skipViewTransition();
    await flush();
    expect(leftovers()).toEqual([]);
    expect(last()).toMatchObject({ outcome: "fallback" });
  });

  it("falls back to a full page load when the push throws, and leaves nothing", async () => {
    installViewTransitions();
    const assign = vi.spyOn(fallbackNavigation, "assign").mockImplementation(() => {});
    router.push.mockImplementation(() => {
      throw new Error("router gone");
    });
    expect(pushWithTransition("/kanban")).toBe(true);
    await flush();
    expect(assign).toHaveBeenCalledWith("/kanban");
    expect(leftovers()).toEqual([]);
    expect(last()).toMatchObject({ outcome: "fallback", why: "assign" });
  });

  it("falls back the same way when the push throws after the cap", async () => {
    vi.useFakeTimers();
    const assign = vi.spyOn(fallbackNavigation, "assign").mockImplementation(() => {});
    // The update starts late, as when the capture comes after the cap.
    const { start } = installViewTransitions();
    const realStart = start.getMockImplementation()!;
    start.mockImplementation((update: () => Promise<void>) =>
      realStart(() => new Promise<void>((r) => setTimeout(r, HOLD_CAP_MS + 10)).then(update))
    );
    router.push.mockImplementation(() => {
      throw new Error("router gone");
    });
    pushWithTransition("/kanban");
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS);
    expect(last()).toMatchObject({ outcome: "capped" });
    await vi.advanceTimersByTimeAsync(20);
    expect(assign).toHaveBeenCalledWith("/kanban");
    expect(leftovers()).toEqual([]);
  });

  it("leaves nothing when the browser rejects ready (a duplicate name)", async () => {
    const { made } = installViewTransitions({ duplicateInNew: true });
    pushWithTransition("/kanban");
    await flush();
    expect(made[0].vtAtCapture).toBe("page");
    notifyRouteCommitted("/kanban");
    await flush();
    expect(leftovers()).toEqual([]);
    expect(last()).toMatchObject({ outcome: "fallback" });
  });
});

describe("a second tap", () => {
  it("skips the running change and changes the page plainly, last tap last", async () => {
    const { start, made } = installViewTransitions();
    pushWithTransition("/kanban");
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(pushWithTransition("/retro")).toBe(true);
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    await flush();
    // One transition only; the second went plainly, after the first.
    expect(start).toHaveBeenCalledTimes(1);
    expect(router.push.mock.calls.map((c) => c[0])).toEqual(["/kanban", "/retro"]);
    expect(leftovers()).toEqual([]);
    notifyRouteCommitted("/retro");
    await flush();
    const taps = pageChangeLog().slice(-2);
    expect(taps.map((t) => [t.href, t.outcome])).toEqual([
      ["/kanban", "fallback"],
      ["/retro", "instant"],
    ]);
  });

  it("keeps the order for a tap that would be instant on its own", async () => {
    installViewTransitions();
    pushWithTransition("/kanban");
    await flush();
    expect(pushWithTransition("/kanban?ep=1", { prefetch: false })).toBe(true);
    await flush();
    expect(router.push.mock.calls.map((c) => c[0])).toEqual(["/kanban", "/kanban?ep=1"]);
  });
});

describe("waiting for a running change", () => {
  it("runs at once when none runs, and after the running one otherwise", async () => {
    const { made } = installViewTransitions();
    const now = vi.fn();
    afterPageTransition(now);
    expect(now).toHaveBeenCalledTimes(1);

    pushWithTransition("/kanban");
    const later = vi.fn();
    const dropped = vi.fn();
    afterPageTransition(later);
    afterPageTransition(dropped)();
    await flush();
    notifyRouteCommitted("/kanban");
    await flush();
    expect(later).not.toHaveBeenCalled();
    made[0].endAnimation();
    await flush();
    expect(later).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });
});

describe("measuring", () => {
  it("adds one page-change measure per tap, with its outcome", async () => {
    vi.useFakeTimers();
    const measure = vi.fn();
    Object.defineProperty(performance, "measure", { configurable: true, value: measure });
    const { made } = installViewTransitions();

    pushWithTransition("/kanban", { prefetch: false });
    pushWithTransition("/retro");
    await vi.advanceTimersByTimeAsync(0);
    notifyRouteCommitted("/retro");
    await vi.advanceTimersByTimeAsync(0);
    made[0].endAnimation();
    await vi.advanceTimersByTimeAsync(0);
    pushWithTransition("/standup");
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS);

    expect(measure).toHaveBeenCalledTimes(3);
    expect(measure.mock.calls.map((c) => c[0])).toEqual([
      "page-change",
      "page-change",
      "page-change",
    ]);
    expect(measure.mock.calls.map((c) => c[1].detail.outcome)).toEqual([
      "instant",
      "ran",
      "capped",
    ]);
    delete (performance as { measure?: unknown }).measure;
  });

  it("keeps the last 20 taps", () => {
    for (let i = 0; i < 25; i++) pushWithTransition(`/kanban?n=${i}`, { prefetch: false });
    const taps = pageChangeLog();
    expect(taps).toHaveLength(20);
    expect(taps[taps.length - 1].href).toBe("/kanban?n=24");
  });
});

describe("the debug switches", () => {
  it("?vt=off forces the plain path for the session, and ?vt=on clears it", () => {
    const { start } = installViewTransitions();
    goTo("/?vt=off");
    expect(readDebugSwitches()).toMatchObject({ off: true });
    goTo("/retro");
    expect(readDebugSwitches()).toMatchObject({ off: true });
    expect(pushWithTransition("/kanban")).toBe(false);
    expect(start).not.toHaveBeenCalled();
    goTo("/retro?vt=on");
    expect(readDebugSwitches()).toMatchObject({ off: false });
    expect(pushWithTransition("/kanban")).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("?vt=off leaves the click to next/link, so a plain arrival plays as without view transitions", () => {
    // The header grow from the card's spot comes with the card frame change;
    // what this switch owes it is the plain path, untouched.
    installViewTransitions();
    goTo("/?vt=off");
    readDebugSwitches();
    const plain = stubRouter();
    expect(pushWithTransition("/kanban", { plain })).toBe(true);
    expect(plain.push).toHaveBeenCalledWith("/kanban", { scroll: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(root.hasAttribute("data-vt")).toBe(false);
  });

  it("?vt-log=1 turns the log on for the session, and ?vt-log=0 off", () => {
    goTo("/?vt-log=1");
    expect(readDebugSwitches()).toMatchObject({ log: true });
    goTo("/kanban");
    expect(readDebugSwitches()).toMatchObject({ log: true });
    goTo("/kanban?vt-log=0");
    expect(readDebugSwitches()).toMatchObject({ log: false });
  });

  it("ignores storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const { start } = installViewTransitions();
    goTo("/?vt=off&vt-log=1");
    expect(readDebugSwitches()).toEqual({ log: false, off: false });
    expect(pushWithTransition("/kanban")).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("DYNAMIC_PATHS", () => {
  it("lists every page.tsx under src/app that exports dynamic = 'force-dynamic'", () => {
    const app = path.join(ROOT, "src/app");
    const found: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx") {
          const src = readFileSync(full, "utf8");
          if (!/export const dynamic\s*=\s*["']force-dynamic["']/.test(src)) continue;
          const segments = path
            .relative(app, dir)
            .split(path.sep)
            .filter((s) => s && !/^\(.*\)$/.test(s));
          found.push(`/${segments.join("/")}`);
        }
      }
    })(app);
    expect(found.length).toBeGreaterThan(0);
    expect([...DYNAMIC_PATHS].sort()).toEqual(found.sort());
  });
});
