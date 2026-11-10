/**
 * The one place a view transition starts. No other file calls the browser's
 * start function (test/motion/guards.test.ts keeps it that way), so these
 * rules hold for every caller: page changes and the reader.
 *
 * - The browser holds the old picture on screen while the update is pending,
 *   so the wait is capped: an update still pending at `capMs` skips the
 *   transition. The page comes back to life at once and the update finishes
 *   as a plain swap.
 * - `html[data-vt]` carries the running kind ("page", "turn", ...). The
 *   VIEW TRANSITIONS block in globals.css names the held layers (Amr, his
 *   bubble and chat panel, the docked timer, the top bar) only under it, so
 *   it must never outlive the transition. It is removed when the transition
 *   finishes, when it is skipped, when the update fails and when the browser
 *   refuses it (a rejected `ready`, for example two elements given one name).
 * - One at a time: a call while another runs skips the running one, and the
 *   new update swaps plainly. The browser calls an update only once it has
 *   captured the old picture, and a skip before that only queues the call,
 *   so a new update waits until the skipped one has begun. Otherwise the
 *   stale change would land last (tap A, then B, and end on A).
 * - A plain swap, with no transition at all, when the browser has none, the
 *   block's --vt-ready marker is missing (without it nothing would be held
 *   still), under reduced motion, while presenting, with an intro on stage
 *   and in a hidden tab.
 */

import { isIntroOnStage } from "./stage";

/** How a call ended. */
export type ViewTransitionOutcome =
  /** No transition was tried: the update ran as a plain swap. */
  | "plain"
  /** The transition ran to its end. */
  | "ran"
  /** The update was still pending at `capMs`: skipped, and the update finished plainly. */
  | "capped"
  /** Skipped by something else: a newer call, skipViewTransition() or the browser. */
  | "skipped";

export interface ViewTransitionOptions {
  /** The longest the old picture may stay on screen while the update is pending, in ms. */
  capMs: number;
}

/** The change itself. While a returned promise is pending, the old picture stays (up to the cap). */
export type ViewTransitionUpdate = () => unknown;

/** The attribute on <html> that names the running kind. */
export const VT_ATTR = "data-vt";

/** Set by the VIEW TRANSITIONS block in globals.css, inside its @supports. */
const READY_PROPERTY = "--vt-ready";

/**
 * A safety net only. The browser always calls an update, after the capture
 * or in a task a skip queues, so this wait never runs out in practice; it
 * keeps a browser bug from holding every later change back.
 */
const START_WAIT_MS = 1000;

/** The parts of the browser's ViewTransition used here. */
interface Transition {
  readonly ready: Promise<unknown>;
  readonly finished: Promise<unknown>;
  readonly updateCallbackDone?: Promise<unknown>;
  skipTransition(): void;
}

interface Running {
  kind: string;
  skip: (why: "capped" | "skipped") => void;
}

/** An update handed to the browser that it has not called yet. */
interface Unstarted {
  begun: Promise<void>;
  /** `begun` or the safety net, whichever comes first. Made once, so waiters keep their order. */
  waited?: Promise<void>;
}

let running: Running | null = null;

/**
 * The last transition's update while the browser has not called it. It can
 * outlive its transition: a skip or the cap before the capture only queues it.
 */
let unstarted: Unstarted | null = null;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

function cssReady(root: HTMLElement): boolean {
  try {
    return getComputedStyle(root).getPropertyValue(READY_PROPERTY).trim() === "1";
  } catch {
    return false;
  }
}

/** Whether a transition may start now. When false, withViewTransition swaps plainly. */
export function canStartViewTransition(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof document.startViewTransition !== "function") return false;
  const root = document.documentElement;
  if (root.dataset.presenting === "true") return false;
  if (isIntroOnStage(root)) return false;
  if (document.visibilityState === "hidden") return false;
  if (prefersReducedMotion()) return false;
  // Last: it reads computed style.
  return cssReady(root);
}

/** Whether a transition (of `kind`, when given) is running. */
export function isViewTransitionRunning(kind?: string): boolean {
  return running !== null && (kind === undefined || running.kind === kind);
}

/** Skip the running transition, if any. Its update still finishes, plainly. */
export function skipViewTransition(): void {
  running?.skip("skipped");
}

/** Resolves once the earlier update the browser has not called yet has begun; null when none waits. */
function afterUnstarted(): Promise<void> | null {
  const pending = unstarted;
  if (!pending) return null;
  pending.waited ??= new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      // Given up on: later calls must not keep waiting for it.
      if (unstarted === pending) unstarted = null;
      resolve();
    }, START_WAIT_MS);
    void pending.begun.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  return pending.waited;
}

async function runPlain(update: ViewTransitionUpdate): Promise<ViewTransitionOutcome> {
  await update();
  return "plain";
}

/** A plain swap: at once, or right after an earlier update the browser has not called yet. */
function plain(update: ViewTransitionUpdate): Promise<ViewTransitionOutcome> {
  const wait = afterUnstarted();
  return wait ? wait.then(() => runPlain(update)) : runPlain(update);
}

/**
 * Run `update` inside a view transition of `kind` when one may start, or as a
 * plain swap otherwise. Settles once everything is over and `data-vt` is
 * gone: after the animation when it ran, as soon as the update settles when
 * it was skipped or plain. Rejects with the update's own error when the update
 * fails, so a caller can fall back. An update that never settles is released
 * at the cap, but its promise never settles either.
 */
export function withViewTransition(
  kind: string,
  update: ViewTransitionUpdate,
  { capMs }: ViewTransitionOptions
): Promise<ViewTransitionOutcome> {
  if (running) {
    running.skip("skipped");
    return plain(update);
  }
  // An earlier update is still queued (its transition was skipped or capped
  // before the capture): this one follows it, plainly.
  if (unstarted || !canStartViewTransition()) return plain(update);

  const root = document.documentElement;
  let outcome: ViewTransitionOutcome = "ran";
  let updateSettled = false;
  let transition: Transition | null = null;
  let begun = false;
  let markBegun!: () => void;
  const entry: Unstarted = { begun: new Promise<void>((resolve) => (markBegun = resolve)) };

  const self: Running = {
    kind,
    skip: (why) => {
      if (running !== self) return;
      outcome = why;
      release();
      transition?.skipTransition();
    },
  };

  // Idempotent: the first of finish, skip or failure takes the names away.
  function release() {
    clearTimeout(capTimer);
    if (running !== self) return;
    running = null;
    root.removeAttribute(VT_ATTR);
  }

  // The clock starts with the call: the old picture is held from the next
  // frame until the update settles.
  const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : 0;
  const capTimer = setTimeout(() => {
    if (!updateSettled) self.skip("capped");
  }, cap);

  // Set before the browser captures the old picture, so the held layers are
  // named in both pictures.
  root.setAttribute(VT_ATTR, kind);
  running = self;
  try {
    transition = document.startViewTransition(async () => {
      begun = true;
      if (unstarted === entry) unstarted = null;
      markBegun();
      try {
        await update();
      } finally {
        updateSettled = true;
        clearTimeout(capTimer);
      }
    });
  } catch {
    // The browser refused to start one; the update has not run yet.
    release();
    return plain(update);
  }
  // The browser calls the update later, after the capture; until then a
  // newer call waits for it.
  if (!begun) unstarted = entry;

  // A rejected ready means the browser skipped it: a duplicate name, a hidden
  // tab, a skip, a failed update. The names go now, not after the update.
  transition.ready.catch(() => self.skip("skipped"));
  // The update's error reaches the caller through `finished`.
  transition.updateCallbackDone?.catch(() => {});

  return transition.finished.then(
    () => {
      release();
      return outcome;
    },
    (error: unknown) => {
      release();
      throw error;
    }
  );
}
