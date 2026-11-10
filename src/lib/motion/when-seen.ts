/**
 * Run something once, when an element first comes into view. One shared
 * IntersectionObserver per threshold serves every caller (home sections,
 * the guess bars), instead of an observer each.
 *
 * - `threshold` is the share of the element that must be on screen, 0 to 1,
 *   as IntersectionObserver defines it (default 0: any part of it).
 * - `maxWaitMs` runs it by then at the latest, seen or not, so a drawing or
 *   a bar never waits forever (an element taller than the screen may never
 *   reach a large share).
 * - Where IntersectionObserver is missing it runs at once, so the finished
 *   state shows.
 *
 * It runs once and then stops watching. The returned function cancels it
 * (the observer and the timer) if it has not run yet; calling it later does
 * nothing.
 */

export interface WhenSeenOptions {
  /** Share of the element that must be visible, 0 to 1. Default 0. */
  threshold?: number;
  /** Run by this many ms at the latest, seen or not. */
  maxWaitMs?: number;
}

interface Watch {
  run: () => void;
}

interface Shared {
  observer: IntersectionObserver;
  watches: Map<Element, Set<Watch>>;
}

/** Keyed by threshold. */
const shared = new Map<number, Shared>();

/**
 * IntersectionObserver reports the crossing itself, but its float ratio can
 * land a hair under the threshold it crossed. Without this slack such an
 * element would wait for the next crossing, which may never come.
 */
const RATIO_SLACK = 0.001;

function clampThreshold(threshold: number | undefined): number {
  if (threshold === undefined || !Number.isFinite(threshold)) return 0;
  return Math.min(1, Math.max(0, threshold));
}

/** One caller's error must not stop the others in the same batch. */
function callSafely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    setTimeout(() => {
      throw error;
    }, 0);
  }
}

function observerFor(threshold: number): Shared {
  const existing = shared.get(threshold);
  if (existing) return existing;
  const watches = new Map<Element, Set<Watch>>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.intersectionRatio + RATIO_SLACK < threshold) continue;
        const set = watches.get(entry.target);
        if (!set) continue;
        // Copy: each run removes its own watch.
        for (const watch of Array.from(set)) callSafely(watch.run);
      }
    },
    { threshold }
  );
  const entry: Shared = { observer, watches };
  shared.set(threshold, entry);
  return entry;
}

function unwatch(threshold: number, el: Element, watch: Watch): void {
  const entry = shared.get(threshold);
  const set = entry?.watches.get(el);
  if (!entry || !set) return;
  set.delete(watch);
  if (set.size > 0) return;
  entry.watches.delete(el);
  entry.observer.unobserve(el);
  if (entry.watches.size === 0) {
    entry.observer.disconnect();
    shared.delete(threshold);
  }
}

export function whenSeen(
  el: Element,
  onSeen: () => void,
  { threshold, maxWaitMs }: WhenSeenOptions = {}
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onSeen();
    return () => {};
  }

  const t = clampThreshold(threshold);
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unwatch(t, el, watch);
  };
  const watch: Watch = {
    run: () => {
      if (done) return;
      stop();
      onSeen();
    },
  };

  const { observer, watches } = observerFor(t);
  let set = watches.get(el);
  if (!set) {
    set = new Set();
    watches.set(el, set);
    observer.observe(el);
  }
  set.add(watch);

  if (maxWaitMs !== undefined && Number.isFinite(maxWaitMs)) {
    timer = setTimeout(watch.run, Math.max(0, maxWaitMs));
  }

  return stop;
}
