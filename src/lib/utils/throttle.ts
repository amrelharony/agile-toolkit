/**
 * Throttle / debounce / requestAnimationFrame throttling helpers.
 *
 * The agile toolkit didn't have any rate-limit utilities before Phase 22.
 * They are needed for cursor broadcasts (60 ms throttle so we don't blow
 * the 10-events/sec Supabase budget), zoom/pan rAF coalescing, and search
 * input debouncing.
 *
 * All three helpers return a function with the same signature as the input.
 * Each carries a `.cancel()` method that drops any pending invocation —
 * call this on unmount to avoid setState-after-unmount warnings.
 */

type Fn<A extends unknown[]> = (...args: A) => void;

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  cancel: () => void;
  /** Force the next pending call to fire immediately (if any). */
  flush: () => void;
}

/**
 * Leading-edge throttle: fires immediately, then suppresses calls for `ms`.
 * Trailing call captured if any args arrive during the cooldown — fires
 * once `ms` elapses with the *last* observed args.
 */
export function throttle<A extends unknown[]>(fn: Fn<A>, ms: number): Throttled<A> {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A | null = null;

  const fire = () => {
    timer = null;
    if (pendingArgs) {
      lastCall = performance.now();
      const args = pendingArgs;
      pendingArgs = null;
      fn(...args);
    }
  };

  const wrapped = (...args: A) => {
    const now = performance.now();
    const elapsed = now - lastCall;
    if (elapsed >= ms) {
      lastCall = now;
      pendingArgs = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fn(...args);
    } else {
      // Coalesce into a trailing call so the final state always lands.
      pendingArgs = args;
      if (!timer) timer = setTimeout(fire, ms - elapsed);
    }
  };

  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      fire();
    }
  };

  return wrapped as Throttled<A>;
}

/**
 * Trailing-edge debounce: only fires once `ms` of silence has elapsed.
 * Use for "stopped typing" / "stopped resizing" / search input.
 */
export function debounce<A extends unknown[]>(fn: Fn<A>, ms: number): Throttled<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const wrapped = (...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) {
        const a = lastArgs;
        lastArgs = null;
        fn(...a);
      }
    }, ms);
  };

  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };
  wrapped.flush = () => {
    if (timer && lastArgs) {
      clearTimeout(timer);
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }
  };

  return wrapped as Throttled<A>;
}

/**
 * requestAnimationFrame throttle — coalesces multiple calls per frame into
 * a single trailing call. Ideal for pan/zoom or pointer-move where you only
 * need the *latest* state per frame.
 */
export function rafThrottle<A extends unknown[]>(fn: Fn<A>): Throttled<A> {
  let frame: number | null = null;
  let pendingArgs: A | null = null;

  const wrapped = (...args: A) => {
    pendingArgs = args;
    if (frame !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      // SSR or unsupported — fire synchronously.
      fn(...args);
      pendingArgs = null;
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      if (pendingArgs) {
        const a = pendingArgs;
        pendingArgs = null;
        fn(...a);
      }
    });
  };

  wrapped.cancel = () => {
    if (frame !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(frame);
    }
    frame = null;
    pendingArgs = null;
  };
  wrapped.flush = () => {
    if (frame !== null && pendingArgs) {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(frame);
      frame = null;
      const a = pendingArgs;
      pendingArgs = null;
      fn(...a);
    }
  };

  return wrapped as Throttled<A>;
}
