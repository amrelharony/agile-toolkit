/**
 * <CastLife> marks a host's figures near the screen (so deferred art loads)
 * and loads life only when it may move them: no reduced motion, no Save-Data
 * or 2G, a visible tab, a figure near, and an idle browser. Never inside an
 * intro overlay. A new `cast` starts it afresh on the figures there now.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const life = vi.hoisted(() => ({
  dispose: vi.fn(),
  startLife: vi.fn(),
  lifeEnv: vi.fn(() => ({ env: true })),
}));
vi.mock("@/lib/cast/life", () => life);

import { CastFigure } from "@/components/cast/cast-figure";
import { CastLife } from "@/components/cast/cast-life";
import { TEST_PUPPET } from "./fixtures/rig-fixture";

class FakeIO {
  static all: FakeIO[] = [];
  observed = new Set<Element>();
  constructor(
    public cb: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
  /** Every watched figure comes near. */
  near() {
    const entries = Array.from(this.observed).map(
      (target) =>
        ({ target, isIntersecting: true, intersectionRatio: 0.1 }) as IntersectionObserverEntry
    );
    this.cb(entries, this as unknown as IntersectionObserver);
  }
}

function media(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function connection(value: object | undefined) {
  Object.defineProperty(navigator, "connection", { value, configurable: true });
}

function visibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function page(props: { host?: string; overlay?: boolean } = {}) {
  const figures = (
    <>
      <CastFigure rig={TEST_PUPPET} height="120px" defer />
      <CastFigure rig={{ ...TEST_PUPPET, id: "AAW-89" }} height="120px" defer />
    </>
  );
  const view = render(
    <div>
      <div data-cast-host="strip">
        {props.overlay ? (
          <div data-intro-overlay="book" role="dialog" aria-modal="true">
            {figures}
          </div>
        ) : (
          figures
        )}
      </div>
      <CastFigure rig={{ ...TEST_PUPPET, id: "AAW-88" }} height="120px" defer />
      <CastLife host={props.host} />
    </div>
  );
  const figs = Array.from(view.container.querySelectorAll<HTMLElement>("[data-cast]"));
  return { ...view, figs, io: FakeIO.all[FakeIO.all.length - 1] };
}

/** Let the idle callback and the dynamic import run. */
async function settle() {
  await vi.advanceTimersByTimeAsync(2500);
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeIO.all = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  media(false);
  connection(undefined);
  visibility("visible");
  life.startLife.mockReset();
  life.startLife.mockReturnValue(life.dispose);
  life.dispose.mockReset();
  life.lifeEnv.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  connection(undefined);
  visibility("visible");
});

describe("CastLife", () => {
  it("renders nothing, and marks the host's figures near as they come close", () => {
    const { figs, io, container } = page({ host: "strip" });
    expect(container.querySelectorAll("[data-cast]")).toHaveLength(3);
    expect(io.options?.rootMargin).toBe("100% 0px");
    expect(io.observed.size).toBe(2);
    expect(figs.some((f) => f.hasAttribute("data-near"))).toBe(false);
    io.near();
    expect(figs.map((f) => f.hasAttribute("data-near"))).toEqual([true, true, false]);
  });

  it("loads life when a figure is near, the tab visible and the browser idle", async () => {
    const { figs, io, container } = page({ host: "strip" });
    await settle();
    expect(life.startLife).not.toHaveBeenCalled();
    io.near();
    await vi.advanceTimersByTimeAsync(100);
    expect(life.startLife).not.toHaveBeenCalled();
    await settle();
    expect(life.startLife).toHaveBeenCalledTimes(1);
    const [host, env] = life.startLife.mock.calls[0];
    expect(host).toBe(container.querySelector('[data-cast-host="strip"]'));
    expect(env).toEqual({ env: true });
    expect(figs.length).toBe(3);
  });

  it("waits for idle time where the browser has it", async () => {
    const idle = vi.fn((cb: () => void) => {
      setTimeout(cb, 50);
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const { io } = page();
    io.near();
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    await settle();
    expect(life.startLife).toHaveBeenCalledWith(document.body, { env: true });
  });

  it("never loads life under reduced motion, but still lets deferred art load", async () => {
    media(true);
    const { figs, io } = page();
    io.near();
    await settle();
    expect(figs.every((f) => f.hasAttribute("data-near"))).toBe(true);
    expect(life.startLife).not.toHaveBeenCalled();
  });

  it.each([
    ["Save-Data", { saveData: true }],
    ["2G", { effectiveType: "2g" }],
    ["slow 2G", { effectiveType: "slow-2g" }],
  ])("never loads life with %s", async (_label, conn) => {
    connection(conn);
    const { io } = page();
    io.near();
    await settle();
    expect(life.startLife).not.toHaveBeenCalled();
  });

  it("waits for a hidden tab to show", async () => {
    visibility("hidden");
    const { io } = page();
    io.near();
    await settle();
    expect(life.startLife).not.toHaveBeenCalled();
    visibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(life.startLife).toHaveBeenCalledTimes(1);
  });

  it("does nothing inside an intro overlay", async () => {
    page({ host: "strip", overlay: true });
    expect(FakeIO.all).toHaveLength(0);
    await settle();
    expect(life.startLife).not.toHaveBeenCalled();
  });

  it("stops watching and disposes life when it unmounts", async () => {
    const { io, unmount } = page();
    io.near();
    await settle();
    expect(life.startLife).toHaveBeenCalledTimes(1);
    unmount();
    expect(life.dispose).toHaveBeenCalledTimes(1);
    expect(io.observed.size).toBe(0);
  });

  it("starts afresh on the figures it is given when `cast` changes", async () => {
    const view = (ids: `AAW-${string}`[]) => (
      <div>
        <div data-cast-host="strip">
          {ids.map((id) => (
            <CastFigure key={id} rig={{ ...TEST_PUPPET, id }} height="120px" defer />
          ))}
        </div>
        <CastLife host="strip" cast={ids.join(" ")} />
      </div>
    );
    const { rerender, container } = render(view(["AAW-90", "AAW-89"]));
    FakeIO.all.at(-1)!.near();
    await settle();
    expect(life.startLife).toHaveBeenCalledTimes(1);
    const watchers = FakeIO.all.length;

    // The same figures: nothing restarts.
    rerender(view(["AAW-90", "AAW-89"]));
    expect(FakeIO.all).toHaveLength(watchers);

    rerender(view(["AAW-87"]));
    expect(life.dispose).toHaveBeenCalledTimes(1);
    const io = FakeIO.all.at(-1)!;
    const fresh = container.querySelector<HTMLElement>('[data-cast="AAW-87"]')!;
    expect(Array.from(io.observed)).toEqual([fresh]);
    expect(fresh.hasAttribute("data-near")).toBe(false);
    io.near();
    expect(fresh.hasAttribute("data-near")).toBe(true);
    await settle();
    expect(life.startLife).toHaveBeenCalledTimes(2);
  });

  it("never starts life after it has unmounted", async () => {
    const { io, unmount } = page();
    io.near();
    unmount();
    await settle();
    expect(life.startLife).not.toHaveBeenCalled();
  });
});
