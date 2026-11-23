/**
 * whenSeen: one shared IntersectionObserver per threshold, a run that happens
 * once, a latest time, and the finished state where there is no observer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenSeen } from "@/lib/motion/when-seen";

class FakeObserver {
  static made: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {}
  ) {
    FakeObserver.made.push(this);
  }

  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }

  /** Report `el` with `ratio` of it on screen. */
  report(el: Element, ratio: number, isIntersecting = ratio > 0) {
    const entry = { target: el, intersectionRatio: ratio, isIntersecting };
    this.callback([entry as unknown as IntersectionObserverEntry], this as never);
  }
}

const cleanups: (() => void)[] = [];

function watch(...args: Parameters<typeof whenSeen>) {
  const stop = whenSeen(...args);
  cleanups.push(stop);
  return stop;
}

function el() {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

/** The live observer for a threshold. */
function observerFor(threshold: number) {
  const found = FakeObserver.made.filter(
    (o) => !o.disconnected && o.options.threshold === threshold
  );
  expect(found).toHaveLength(1);
  return found[0];
}

beforeEach(() => {
  FakeObserver.made = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("whenSeen", () => {
  it("runs once when the element comes into view, and then stops watching it", () => {
    const target = el();
    const onSeen = vi.fn();
    watch(target, onSeen);
    const io = observerFor(0);
    expect(io.observed.has(target)).toBe(true);

    io.report(target, 0, false);
    expect(onSeen).not.toHaveBeenCalled();
    io.report(target, 0.4);
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(io.observed.has(target)).toBe(false);

    io.report(target, 1);
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it("waits for the threshold's share of the element", () => {
    const target = el();
    const onSeen = vi.fn();
    watch(target, onSeen, { threshold: 0.08 });
    const io = observerFor(0.08);
    // Intersecting, but under 8%: the first report on observe looks like this.
    io.report(target, 0.04);
    expect(onSeen).not.toHaveBeenCalled();
    // A crossing reported a hair under its own threshold still counts.
    io.report(target, 0.0799995);
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it("shares one observer per threshold", () => {
    const a = el();
    const b = el();
    const c = el();
    watch(a, vi.fn(), { threshold: 0.08 });
    watch(b, vi.fn(), { threshold: 0.08 });
    watch(c, vi.fn());
    expect(FakeObserver.made).toHaveLength(2);
    expect(observerFor(0.08).observed).toEqual(new Set([a, b]));
    expect(observerFor(0).observed).toEqual(new Set([c]));
    // Out-of-range thresholds are clamped onto the same keys.
    watch(el(), vi.fn(), { threshold: -1 });
    watch(el(), vi.fn(), { threshold: Number.NaN });
    expect(FakeObserver.made).toHaveLength(2);
  });

  it("with a rootMargin, watches on its own observer with that margin, shared by it", () => {
    const plain = el();
    const near = el();
    const alsoNear = el();
    const onNear = vi.fn();
    watch(plain, vi.fn());
    watch(near, onNear, { rootMargin: "300px 0px" });
    watch(alsoNear, vi.fn(), { rootMargin: " 300px 0px " });
    expect(FakeObserver.made).toHaveLength(2);
    const withMargin = FakeObserver.made.find((o) => o.options.rootMargin === "300px 0px")!;
    expect(withMargin.options.threshold).toBe(0);
    expect(withMargin.observed).toEqual(new Set([near, alsoNear]));
    // The plain one keeps IntersectionObserver's own default margin.
    const noMargin = FakeObserver.made.find((o) => o !== withMargin)!;
    expect(noMargin.options).toEqual({ threshold: 0 });
    expect(noMargin.observed).toEqual(new Set([plain]));
    withMargin.report(near, 0, true);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(withMargin.observed).toEqual(new Set([alsoNear]));
  });

  it("runs every caller watching one element, and each cleanup is its own", () => {
    const target = el();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = watch(target, first);
    watch(target, second);
    const io = observerFor(0);
    stopFirst();
    expect(io.observed.has(target)).toBe(true);
    io.report(target, 1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(io.observed.has(target)).toBe(false);
  });

  it("with maxWaitMs runs by then at the latest, once", () => {
    vi.useFakeTimers();
    const target = el();
    const onSeen = vi.fn();
    watch(target, onSeen, { maxWaitMs: 1500 });
    const io = observerFor(0);
    vi.advanceTimersByTime(1499);
    expect(onSeen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(io.observed.has(target)).toBe(false);
    io.report(target, 1);
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it("with maxWaitMs still runs as soon as it is seen, and only then", () => {
    vi.useFakeTimers();
    const target = el();
    const onSeen = vi.fn();
    watch(target, onSeen, { maxWaitMs: 1500 });
    vi.advanceTimersByTime(500);
    observerFor(0).report(target, 1);
    expect(onSeen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it("runs at once where IntersectionObserver is missing", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const onSeen = vi.fn();
    const stop = watch(el(), onSeen, { maxWaitMs: 1000 });
    expect(onSeen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
  });

  it("cleanup stops both the observer and the timer", () => {
    vi.useFakeTimers();
    const target = el();
    const onSeen = vi.fn();
    const stop = watch(target, onSeen, { threshold: 0.5, maxWaitMs: 1000 });
    const io = observerFor(0.5);
    stop();
    expect(io.observed.has(target)).toBe(false);
    // The last watch gone, the observer goes too.
    expect(io.disconnected).toBe(true);
    io.report(target, 1);
    vi.advanceTimersByTime(2000);
    expect(onSeen).not.toHaveBeenCalled();
    // A later call does nothing.
    expect(() => stop()).not.toThrow();
  });

  it("a caller that throws does not stop the others in the same report", () => {
    vi.useFakeTimers();
    const a = el();
    const b = el();
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    const fine = vi.fn();
    watch(a, boom);
    watch(b, fine);
    const io = observerFor(0);
    const both = [
      { target: a, intersectionRatio: 1, isIntersecting: true },
      { target: b, intersectionRatio: 1, isIntersecting: true },
    ] as unknown as IntersectionObserverEntry[];
    io.callback(both, io as never);
    expect(boom).toHaveBeenCalledTimes(1);
    expect(fine).toHaveBeenCalledTimes(1);
    // The error is reported, not swallowed.
    expect(() => vi.runOnlyPendingTimers()).toThrow("boom");
  });
});
