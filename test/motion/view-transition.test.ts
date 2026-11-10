/**
 * The one view-transition core: when it runs a transition and when it swaps
 * plainly, the wait cap, and html[data-vt] never outliving the transition.
 * The browser's start function is a fake that follows the spec's order: the
 * old picture is captured first, the update runs after, `ready` settles when
 * the update is done (or rejects on a skip), and `finished` settles after the
 * animation, or right after the update when skipped. With `captureMs` the
 * capture waits on a timer, and a skip before it only queues the update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VT_ATTR,
  canStartViewTransition,
  isViewTransitionRunning,
  skipViewTransition,
  withViewTransition,
} from "@/lib/motion/view-transition";
import { isIntroOnStage } from "@/lib/motion/stage";
import { getQuietState } from "@/lib/notify/quiet-state";

const root = document.documentElement;
const CAP = 150;

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeTransition {
  /** data-vt when the old picture was captured. */
  vtAtCapture: string | null;
  skipTransition: ReturnType<typeof vi.fn>;
  /** Ends the animation of a transition that ran. */
  endAnimation: () => void;
}

interface FakeOptions {
  /** Two elements share a name in the old picture: the browser skips at once. */
  duplicateInOld?: boolean;
  /** Two elements share a name in the new picture: skipped after the update. */
  duplicateInNew?: boolean;
  /** The start function itself throws. */
  throwOnStart?: boolean;
  /**
   * The capture takes this long (a timer), as when the next frame comes late.
   * A skip before then queues the update as a task (a 0 ms timer), as the
   * spec says. Unset: the update runs a microtask after the start.
   */
  captureMs?: number;
  /** A browser bug: the update is never called. */
  neverCallsUpdate?: boolean;
}

function installBrowser(options: FakeOptions = {}) {
  const made: FakeTransition[] = [];
  const start = vi.fn((update: () => Promise<void>) => {
    if (options.throwOnStart) throw new DOMException("No", "InvalidStateError");
    const ready = deferred();
    const finished = deferred();
    const animation = deferred();
    let skipped = false;
    let readySettled = false;
    const rejectReady = (error: unknown) => {
      if (readySettled) return;
      readySettled = true;
      ready.reject(error);
    };
    let call!: () => void;
    const called = new Promise<void>((resolve) => (call = resolve));
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    const skipTransition = vi.fn(() => {
      if (skipped) return;
      skipped = true;
      rejectReady(new DOMException("Skipped", "AbortError"));
      // Skipped before the capture: the update is queued as a task.
      if (captureTimer !== undefined) {
        clearTimeout(captureTimer);
        captureTimer = undefined;
        setTimeout(call, 0);
      }
    });
    const fake: FakeTransition = {
      vtAtCapture: root.getAttribute(VT_ATTR),
      skipTransition,
      endAnimation: () => animation.resolve(),
    };
    made.push(fake);
    if (options.duplicateInOld) {
      skipped = true;
      rejectReady(new DOMException("Duplicate name", "InvalidStateError"));
    }
    // The update runs after the old picture is captured, never synchronously.
    const updateCallbackDone = called.then(() => update());
    if (options.neverCallsUpdate) {
      // Left uncalled.
    } else if (options.captureMs === undefined) {
      call();
    } else {
      captureTimer = setTimeout(() => {
        captureTimer = undefined;
        call();
      }, options.captureMs);
    }
    updateCallbackDone.then(
      () => {
        if (options.duplicateInNew && !skipped) {
          skipped = true;
          rejectReady(new DOMException("Duplicate name", "InvalidStateError"));
        }
        if (skipped) {
          finished.resolve();
          return;
        }
        readySettled = true;
        ready.resolve();
        void animation.promise.then(() => finished.resolve());
      },
      (error) => {
        skipped = true;
        rejectReady(error);
        finished.reject(error);
      }
    );
    return {
      ready: ready.promise,
      finished: finished.promise,
      updateCallbackDone,
      skipTransition,
    };
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: start,
  });
  return { start, made };
}

/** Let promise callbacks run. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  root.style.setProperty("--vt-ready", "1");
});

afterEach(() => {
  skipViewTransition();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete (document as { visibilityState?: unknown }).visibilityState;
  root.style.removeProperty("--vt-ready");
  root.removeAttribute(VT_ATTR);
  delete root.dataset.presenting;
  delete root.dataset.intro;
});

describe("plain swaps", () => {
  it("swaps plainly when the browser has no view transitions", async () => {
    const seen: (string | null)[] = [];
    const update = vi.fn(() => {
      seen.push(root.getAttribute(VT_ATTR));
    });
    expect(canStartViewTransition()).toBe(false);
    await expect(withViewTransition("page", update, { capMs: CAP })).resolves.toBe("plain");
    expect(update).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null]);
  });

  it.each([
    [
      "under reduced motion",
      () => {
        vi.spyOn(window, "matchMedia").mockImplementation(
          (query: string) =>
            ({ matches: query === "(prefers-reduced-motion: reduce)", media: query }) as never
        );
      },
    ],
    ["while presenting", () => (root.dataset.presenting = "true")],
    ["with an intro on stage", () => (root.dataset.intro = "book")],
    [
      "in a hidden tab",
      () =>
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        }),
    ],
    ["when the stylesheet's marker is missing", () => root.style.removeProperty("--vt-ready")],
  ])("swaps plainly %s", async (_name, arrange) => {
    const { start } = installBrowser();
    expect(canStartViewTransition()).toBe(true);
    arrange();
    expect(canStartViewTransition()).toBe(false);
    const update = vi.fn();
    await expect(withViewTransition("page", update, { capMs: CAP })).resolves.toBe("plain");
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it("does not count presenting=false as presenting", () => {
    installBrowser();
    root.dataset.presenting = "false";
    expect(canStartViewTransition()).toBe(true);
  });

  it("still changes the page when the browser refuses to start one", async () => {
    const { start } = installBrowser({ throwOnStart: true });
    const update = vi.fn();
    await expect(withViewTransition("page", update, { capMs: CAP })).resolves.toBe("plain");
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
  });
});

describe("a transition that runs", () => {
  it("names the kind on <html> from the old picture to the end, then removes it", async () => {
    const { start, made } = installBrowser();
    const during: (string | null)[] = [];
    const result = withViewTransition(
      "page",
      () => {
        during.push(root.getAttribute(VT_ATTR));
      },
      { capMs: CAP }
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(made[0].vtAtCapture).toBe("page");
    expect(isViewTransitionRunning()).toBe(true);
    expect(isViewTransitionRunning("page")).toBe(true);
    expect(isViewTransitionRunning("turn")).toBe(false);
    await flush();
    expect(during).toEqual(["page"]);
    // The update is done; the animation still runs, and the layers stay held.
    expect(root.getAttribute(VT_ATTR)).toBe("page");
    made[0].endAnimation();
    await expect(result).resolves.toBe("ran");
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
    expect(made[0].skipTransition).not.toHaveBeenCalled();
  });

  it("waits for an update that returns a promise, and never skips one done before the cap", async () => {
    vi.useFakeTimers();
    const { made } = installBrowser();
    const arrival = deferred();
    const update = vi.fn(() => arrival.promise);
    const result = withViewTransition("page", update, { capMs: CAP });
    await vi.advanceTimersByTimeAsync(CAP - 50);
    arrival.resolve();
    await vi.advanceTimersByTimeAsync(CAP * 4);
    expect(made[0].skipTransition).not.toHaveBeenCalled();
    expect(root.getAttribute(VT_ATTR)).toBe("page");
    made[0].endAnimation();
    await expect(result).resolves.toBe("ran");
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });
});

describe("the wait cap", () => {
  it("skips an update still pending at capMs, and the page swaps plainly when it arrives", async () => {
    vi.useFakeTimers();
    const { made } = installBrowser();
    const arrival = deferred();
    const update = vi.fn(() => arrival.promise);
    let settled = false;
    const result = withViewTransition("page", update, { capMs: CAP });
    void result.then(() => (settled = true));

    await vi.advanceTimersByTimeAsync(CAP - 1);
    expect(made[0].skipTransition).not.toHaveBeenCalled();
    expect(root.getAttribute(VT_ATTR)).toBe("page");

    await vi.advanceTimersByTimeAsync(1);
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    // The screen is released at once: no names, nothing running.
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
    expect(settled).toBe(false);

    arrival.resolve();
    await expect(result).resolves.toBe("capped");
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it.each([[-5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "treats a cap of %s as no wait at all, never as an endless hold",
    async (capMs) => {
      vi.useFakeTimers();
      const { made } = installBrowser();
      const arrival = deferred();
      const result = withViewTransition("page", () => arrival.promise, { capMs });
      await vi.advanceTimersByTimeAsync(0);
      expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
      expect(root.hasAttribute(VT_ATTR)).toBe(false);
      arrival.resolve();
      await expect(result).resolves.toBe("capped");
    }
  );
});

describe("html[data-vt] is always removed", () => {
  it("after an update that throws, and the error reaches the caller", async () => {
    installBrowser();
    const result = withViewTransition(
      "page",
      () => {
        throw new Error("push failed");
      },
      { capMs: CAP }
    );
    await expect(result).rejects.toThrow("push failed");
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
  });

  it("after an update that rejects later", async () => {
    installBrowser();
    const arrival = deferred();
    const result = withViewTransition("page", () => arrival.promise, { capMs: 10_000 });
    await flush();
    expect(root.getAttribute(VT_ATTR)).toBe("page");
    arrival.reject(new Error("offline"));
    await expect(result).rejects.toThrow("offline");
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it("as soon as ready is rejected (two elements given one name), before the update is done", async () => {
    const { made } = installBrowser({ duplicateInOld: true });
    const arrival = deferred();
    const result = withViewTransition("page", () => arrival.promise, { capMs: 10_000 });
    await flush();
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
    arrival.resolve();
    await expect(result).resolves.toBe("skipped");
    expect(made[0].vtAtCapture).toBe("page");
  });

  it("when ready is rejected after the update (a duplicate in the new picture)", async () => {
    installBrowser({ duplicateInNew: true });
    const result = withViewTransition("page", () => {}, { capMs: CAP });
    await expect(result).resolves.toBe("skipped");
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it("after skipViewTransition(); the update still finishes", async () => {
    const { made } = installBrowser();
    const arrival = deferred();
    const update = vi.fn(() => arrival.promise);
    const result = withViewTransition("turn", update, { capMs: 10_000 });
    expect(root.getAttribute(VT_ATTR)).toBe("turn");
    skipViewTransition();
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    arrival.resolve();
    await expect(result).resolves.toBe("skipped");
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("one at a time", () => {
  it("a second call in the same task waits for the first update to begin, so the newer change lands last", async () => {
    const { start, made } = installBrowser();
    const order: string[] = [];
    const firstResult = withViewTransition("page", () => void order.push("A"), { capMs: CAP });
    // No flush: the browser has not called the first update yet.
    const secondResult = withViewTransition("page", () => void order.push("B"), { capMs: CAP });
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(order).toEqual([]);
    await expect(secondResult).resolves.toBe("plain");
    expect(order).toEqual(["A", "B"]);
    await expect(firstResult).resolves.toBe("skipped");
    expect(start).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
  });

  it("keeps the order when the capture comes a frame later and a skip only queues the update", async () => {
    vi.useFakeTimers();
    const { made } = installBrowser({ captureMs: 16 });
    const order: string[] = [];
    const firstResult = withViewTransition("page", () => void order.push("A"), { capMs: CAP });
    const secondResult = withViewTransition("page", () => void order.push("B"), { capMs: CAP });
    const third = withViewTransition("page", () => void order.push("C"), { capMs: CAP });
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["A", "B", "C"]);
    await expect(firstResult).resolves.toBe("skipped");
    await expect(secondResult).resolves.toBe("plain");
    await expect(third).resolves.toBe("plain");
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it("runs a new update after one the cap skipped before the capture", async () => {
    vi.useFakeTimers();
    const { start, made } = installBrowser({ captureMs: CAP + 50 });
    const order: string[] = [];
    const firstResult = withViewTransition("page", () => void order.push("A"), { capMs: CAP });
    // Only the cap fires; the update it queued has not run yet.
    await vi.advanceTimersToNextTimerAsync();
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    expect(order).toEqual([]);
    expect(isViewTransitionRunning()).toBe(false);
    const secondResult = withViewTransition("page", () => void order.push("B"), { capMs: CAP });
    expect(start).toHaveBeenCalledTimes(1);
    // The fake clock gives a 0 ms timer made inside a timer 1 ms.
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["A", "B"]);
    await expect(firstResult).resolves.toBe("capped");
    await expect(secondResult).resolves.toBe("plain");
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it("stops waiting for an update the browser never calls after a second, then starts transitions again", async () => {
    vi.useFakeTimers();
    installBrowser({ neverCallsUpdate: true });
    void withViewTransition("page", () => {}, { capMs: CAP });
    const second = vi.fn();
    const secondResult = withViewTransition("page", second, { capMs: CAP });
    await vi.advanceTimersByTimeAsync(999);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalledTimes(1);
    await expect(secondResult).resolves.toBe("plain");

    const { start, made } = installBrowser();
    const third = withViewTransition("page", () => {}, { capMs: CAP });
    expect(start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    made[0].endAnimation();
    await expect(third).resolves.toBe("ran");
  });

  it("a second call after the first update has begun skips the running one and swaps at once", async () => {
    const { start, made } = installBrowser();
    const first = deferred();
    const firstUpdate = vi.fn(() => first.promise);
    const firstResult = withViewTransition("page", firstUpdate, { capMs: 10_000 });
    await flush();

    const secondUpdate = vi.fn();
    const secondResult = withViewTransition("page", secondUpdate, { capMs: 10_000 });
    expect(made[0].skipTransition).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
    await expect(secondResult).resolves.toBe("plain");
    expect(secondUpdate).toHaveBeenCalledTimes(1);

    first.resolve();
    await expect(firstResult).resolves.toBe("skipped");
    expect(firstUpdate).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(VT_ATTR)).toBe(false);
  });

  it("starts a new one once the last is over", async () => {
    const { start, made } = installBrowser();
    const one = withViewTransition("page", () => {}, { capMs: CAP });
    await flush();
    made[0].endAnimation();
    await expect(one).resolves.toBe("ran");
    const two = withViewTransition("page", () => {}, { capMs: CAP });
    expect(start).toHaveBeenCalledTimes(2);
    await flush();
    made[1].endAnimation();
    await expect(two).resolves.toBe("ran");
  });
});

describe("isIntroOnStage", () => {
  it.each([[undefined], [""], ["poster"], ["book"], ["vip"]])(
    "agrees with the quiet state's intro rule for data-intro=%s",
    (value) => {
      if (value === undefined) delete root.dataset.intro;
      else root.dataset.intro = value;
      const quietSaysIntro = getQuietState(Date.now(), "/", root).reason === "intro";
      expect(isIntroOnStage(root)).toBe(quietSaysIntro);
      expect(isIntroOnStage()).toBe(quietSaysIntro);
    }
  );

  it("is false with no document element", () => {
    expect(isIntroOnStage(null)).toBe(false);
  });
});
