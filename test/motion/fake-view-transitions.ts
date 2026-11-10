/**
 * A fake of the browser's view-transition start function for the page-change
 * tests, following the spec's order (as test/motion/view-transition.test.ts
 * does): the old picture is captured first, the update runs a microtask
 * later, `ready` settles once the update is done (or rejects on a skip), and
 * `finished` settles after the animation, or right after the update when
 * skipped. Not a test file: the page-change tests import it.
 */
import { vi } from "vitest";

const root = document.documentElement;

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

export interface FakeTransition {
  /** html[data-vt] when the old picture was captured. */
  vtAtCapture: string | null;
  skipTransition: ReturnType<typeof vi.fn>;
  /** Ends the animation of a transition that ran. */
  endAnimation: () => void;
  /** Settles when the update has. */
  updateDone: Promise<unknown>;
}

export interface FakeOptions {
  /** Two elements share a name in the new picture: the browser skips after the update. */
  duplicateInNew?: boolean;
}

export function installViewTransitions(options: FakeOptions = {}) {
  const made: FakeTransition[] = [];
  const start = vi.fn((update: () => Promise<void>) => {
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
    const skipTransition = vi.fn(() => {
      if (skipped) return;
      skipped = true;
      rejectReady(new DOMException("Skipped", "AbortError"));
    });
    // The update runs after the capture, never synchronously.
    const updateCallbackDone = Promise.resolve().then(() => update());
    made.push({
      vtAtCapture: root.getAttribute("data-vt"),
      skipTransition,
      endAnimation: () => animation.resolve(),
      updateDone: updateCallbackDone.catch(() => {}),
    });
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
    // Callers that ignore these must not leave unhandled rejections.
    ready.promise.catch(() => {});
    finished.promise.catch(() => {});
    return { ready: ready.promise, finished: finished.promise, updateCallbackDone, skipTransition };
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: start,
  });
  // The VIEW TRANSITIONS block's marker; jsdom does not load globals.css.
  root.style.setProperty("--vt-ready", "1");
  return { start, made };
}

export function removeViewTransitions(): void {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  root.style.removeProperty("--vt-ready");
  root.removeAttribute("data-vt");
}

/** Let promise callbacks run. */
export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
