/**
 * Estimate without a meeting: a round's names and notes don't stay in
 * storage past its 14 days. Every reader already shows an expired round
 * closed (`readAsyncRound`); this writes that closed copy back to the
 * workspace on any page, not only on Planning Poker, so the stored row
 * (and, for a signed-in owner, the synced one) drops them the next time
 * the toolkit opens after the round's `keepUntil` day.
 *
 * - `expireStoredRounds` is the pure part: the stored list with each row
 *   as `readAsyncRound` shows it (a malformed row repaired, an expired one
 *   closed), or null when nothing changes. A row it can't read at all is
 *   kept as it is, as the Poker page always left it.
 * - `watchAsyncRoundExpiry` runs it on the workspace store when hydration
 *   finishes (and on every later rehydrate, such as another tab's write),
 *   when the slice changes (sync from another device, an import), and when
 *   the page comes back into view (a round can expire while a tab stays
 *   open). It writes outside the setState that brought the change, so the
 *   sync engine pushes the cleaned rows as a local write, and its own
 *   write never sets off another check.
 */

import type { PokerAsyncRound } from "@/lib/stores/workspace-types";
import { readAsyncRound, readPokerAsyncRound } from "./async-rounds";

/**
 * `stored` with every readable round as `readAsyncRound` shows it at
 * `now`, or null when that changes nothing (so there is nothing to write).
 */
export function expireStoredRounds(
  stored: readonly unknown[] | undefined,
  now: Date = new Date()
): PokerAsyncRound[] | null {
  if (!Array.isArray(stored)) return null;
  let changed = false;
  const next = stored.map((raw) => {
    const round = readPokerAsyncRound(raw);
    if (!round) return raw;
    const read = readAsyncRound(round, now);
    if (read !== raw) changed = true;
    return read;
  });
  return changed ? (next as PokerAsyncRound[]) : null;
}

interface RoundsState {
  pokerAsyncRounds?: PokerAsyncRound[];
}

/** The part of the workspace store the watcher uses. */
export interface AsyncRoundStore {
  getState(): RoundsState;
  setState(partial: { pokerAsyncRounds: PokerAsyncRound[] }): void;
  subscribe(listener: (state: RoundsState, prev: RoundsState) => void): () => void;
  persist: {
    hasHydrated(): boolean;
    onFinishHydration(listener: () => void): () => void;
  };
}

/**
 * Keep `store`'s rounds expired as they're read: see the file's comment.
 * `defer` runs the check after the current setState (a timeout by
 * default). Returns a function that stops watching.
 */
export function watchAsyncRoundExpiry(
  store: AsyncRoundStore,
  defer: (run: () => void) => void = (run) => {
    setTimeout(run, 0);
  }
): () => void {
  let stopped = false;
  let pending = false;
  let written: PokerAsyncRound[] | null = null;

  const run = () => {
    pending = false;
    if (stopped || !store.persist.hasHydrated()) return;
    const next = expireStoredRounds(store.getState().pokerAsyncRounds);
    if (!next) return;
    written = next;
    store.setState({ pokerAsyncRounds: next });
  };
  const check = () => {
    if (pending || stopped) return;
    pending = true;
    defer(run);
  };

  const stopHydration = store.persist.onFinishHydration(check);
  const stopStore = store.subscribe((state, prev) => {
    const rounds = state.pokerAsyncRounds;
    // The list this watcher wrote reads back unchanged: no second check for it.
    if (rounds !== prev.pokerAsyncRounds && rounds !== written) check();
  });
  const onShow = () => {
    if (document.visibilityState === "visible") check();
  };
  const watchesView = typeof document !== "undefined";
  if (watchesView) document.addEventListener("visibilitychange", onShow);
  if (store.persist.hasHydrated()) check();

  return () => {
    stopped = true;
    stopHydration();
    stopStore();
    if (watchesView) document.removeEventListener("visibilitychange", onShow);
  };
}
