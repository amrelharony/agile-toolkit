/**
 * Keeps the screen on while a visitor live room is open in this tab.
 *
 * A phone that dims and locks in the middle of a Poker round, a retro or a
 * vote round drops out of the room until someone wakes it. So while a room
 * is open, whether this tab hosts it or joined it, the tab asks for a screen
 * wake lock (`navigator.wakeLock`). Browsers let go of the lock whenever the
 * page is hidden, so the tab asks again each time the page becomes visible,
 * and it lets go itself when the last room in the tab is left or ended.
 *
 * Where the browser has no wake lock or refuses one (an older browser,
 * battery saver, a page that isn't visible, a permissions policy), the room
 * carries on as before: nothing is shown and nothing is thrown.
 *
 * Counted like `enterLiveVisitorRoom`: two rooms in one tab share one lock.
 * No imports and no browser globals at import time.
 */

/** The part of a `WakeLockSentinel` used here. */
interface Sentinel {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
}

/** The part of `navigator.wakeLock` used here. */
interface WakeLockApi {
  request(type: "screen"): Promise<Sentinel>;
}

let holders = 0;
let sentinel: Sentinel | null = null;
let asking = false;

function wakeLockApi(): WakeLockApi | null {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as { wakeLock?: Partial<WakeLockApi> }).wakeLock;
  return api && typeof api.request === "function" ? (api as WakeLockApi) : null;
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function letGo(lock: Sentinel): void {
  try {
    void Promise.resolve(lock.release()).catch(() => {});
  } catch {
    // Already released.
  }
}

/** Ask for the lock, unless one is held or on its way, or the page is hidden. */
async function ask(): Promise<void> {
  if (holders === 0 || asking || !pageVisible()) return;
  if (sentinel && !sentinel.released) return;
  const api = wakeLockApi();
  if (!api) return;
  asking = true;
  try {
    const lock = await api.request("screen");
    if (holders === 0) {
      // The room closed while the browser was answering.
      letGo(lock);
      return;
    }
    sentinel = lock;
    lock.addEventListener?.("release", () => {
      if (sentinel === lock) sentinel = null;
    });
  } catch {
    // Refused (battery saver, a hidden page, a permissions policy): carry on.
  } finally {
    asking = false;
  }
}

function onVisibilityChange(): void {
  if (pageVisible()) void ask();
}

/**
 * Call when a visitor room opens in this tab (hosting or joining); call the
 * function it returns when the room is left or ended. Calling the returned
 * function twice is safe.
 */
export function holdScreenAwake(): () => void {
  holders += 1;
  if (holders === 1 && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  void ask();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders -= 1;
    if (holders > 0) return;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    const lock = sentinel;
    sentinel = null;
    if (lock) letGo(lock);
  };
}
