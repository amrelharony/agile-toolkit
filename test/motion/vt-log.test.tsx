/**
 * RouteSignal, which reports each page's arrival and lends page changes the
 * router, and the ?vt-log=1 table it loads only when the switch is on. The
 * table shows taps kept in memory and never sends anything.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/",
  search: "",
  router: { push: (() => {}) as (href: string) => void, replace: () => {}, prefetch: () => {} },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { RouteSignal } from "@/components/motion/route-signal";
import VtLog from "@/components/motion/vt-log";
import { pageChangeLog, pushWithTransition, readDebugSwitches } from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { flush, installViewTransitions, removeViewTransitions } from "./fake-view-transitions";

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function at(address: string) {
  window.history.replaceState(null, "", address);
  const url = new URL(address, window.location.href);
  nav.pathname = url.pathname;
  nav.search = url.search.slice(1);
}

function blockStorage() {
  const blocked = () => {
    throw new DOMException("Blocked", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
}

beforeEach(() => {
  nav.router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };
  at("/");
});

afterEach(async () => {
  skipViewTransition();
  await flush();
  cleanup();
  removeViewTransitions();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  at("/");
  readDebugSwitches();
});

describe("RouteSignal", () => {
  it("lends the router while mounted", () => {
    const { unmount } = render(<RouteSignal />);
    pushWithTransition("/kanban");
    // No view transitions in jsdom: refused for that, not for want of a router.
    expect(pageChangeLog().at(-1)).toMatchObject({ why: "unavailable" });
    unmount();
    pushWithTransition("/kanban");
    expect(pageChangeLog().at(-1)).toMatchObject({ why: "no-router" });
  });

  it("ends a waiting change when the new page commits, without the cap", async () => {
    const { made } = installViewTransitions();
    const { rerender } = render(<RouteSignal />);
    expect(pushWithTransition("/kanban?board=a")).toBe(true);
    await flush();
    expect(nav.router.push).toHaveBeenCalledWith("/kanban?board=a", { scroll: true });
    at("/kanban?board=a");
    rerender(<RouteSignal />);
    await flush();
    expect(made[0].skipTransition).not.toHaveBeenCalled();
    made[0].endAnimation();
    await flush();
    expect(pageChangeLog().at(-1)).toMatchObject({ href: "/kanban?board=a", outcome: "ran" });
  });

  it("reports the arrival from a layout effect, and loads the table only by a dynamic import", () => {
    const src = read("src/components/motion/route-signal.tsx");
    expect(src).toMatch(/useIsomorphicLayoutEffect\(\(\) => notifyRouteCommitted\(href\)/);
    expect(src).toMatch(/import\(["']\.\/vt-log["']\)/);
    expect(src).not.toMatch(/^import[^;]*from\s+["']\.\/vt-log["']/m);
    expect(src).not.toMatch(/requestAnimationFrame|IntersectionObserver|animationend/);
  });
});

describe("the ?vt-log=1 table", () => {
  it("is not there without the switch", async () => {
    render(<RouteSignal />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows with ?vt-log=1, and stays on for the session", async () => {
    at("/?vt-log=1");
    const { rerender } = render(<RouteSignal />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    at("/retro");
    rerender(<RouteSignal />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    at("/retro?vt-log=0");
    rerender(<RouteSignal />);
    await act(async () => {});
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists each tap with how it ended, newest first", async () => {
    at("/?vt-log=1");
    render(<RouteSignal />);
    const table = await screen.findByRole("table");
    act(() => {
      pushWithTransition("/kanban", { prefetch: false });
      pushWithTransition("/squad-session");
    });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("instant (dynamic)");
    expect(rows[0]).toHaveTextContent("/squad-session");
    expect(rows[1]).toHaveTextContent("instant (not-ahead)");
    expect(screen.getByText(/instant \d+/)).toBeInTheDocument();
  });

  it("survives sessionStorage throwing: the switch reads as off, and nothing breaks", async () => {
    blockStorage();
    at("/?vt-log=1");
    expect(() => render(<RouteSignal />)).not.toThrow();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.queryByRole("table")).toBeNull();
    // The router is still lent.
    pushWithTransition("/kanban");
    expect(pageChangeLog().at(-1)).toMatchObject({ why: "unavailable" });
  });

  it("renders from memory even when storage throws", () => {
    blockStorage();
    pushWithTransition("/kanban", { prefetch: false });
    render(<VtLog />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("never calls fetch or sends anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    try {
      at("/?vt-log=1");
      render(<RouteSignal />);
      await screen.findByRole("table");
      act(() => {
        for (let i = 0; i < 3; i++) pushWithTransition(`/kanban?n=${i}`, { prefetch: false });
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { sendBeacon?: unknown }).sendBeacon;
    }
    for (const file of ["src/components/motion/vt-log.tsx", "src/lib/motion/page-transition.ts"]) {
      expect(read(file), file).not.toMatch(
        /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource/
      );
    }
  });

  it("lets taps through and sits under Amr", () => {
    render(<VtLog />);
    const panel = screen.getByRole("region", { name: "Page change log" });
    const cls = (panel.getAttribute("class") ?? "").split(/\s+/);
    expect(cls).toContain("pointer-events-none");
    // Amr is z-50 and the docked timer z-40.
    expect(cls).toContain("z-30");
  });
});
