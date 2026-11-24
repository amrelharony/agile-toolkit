/**
 * A round without a meeting doesn't keep names and notes in storage past
 * its 14 days (lib/estimation/async-expiry). The workspace store closes it
 * on whichever page loads or syncs the rounds, not only on Planning Poker:
 * once hydration finishes, when sync or an import changes the slice, and
 * when a page comes back into view. Each write happens once, after the
 * setState that brought the change, and never sets off another.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/register", () => ({
  registerEntityCollection: () => {},
  registerBlobStore: () => {},
}));

import { expireStoredRounds, watchAsyncRoundExpiry } from "@/lib/estimation/async-expiry";
import type { AsyncRoundStore } from "@/lib/estimation/async-expiry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PokerAsyncRound } from "@/lib/stores/workspace-types";

const AT = "2026-01-01T10:00:00.000Z";

function round(over: Partial<PokerAsyncRound> = {}): PokerAsyncRound {
  return {
    id: "async_r1",
    title: "Checkout stories",
    scaleType: "fibonacci",
    deck: ["1", "2", "3", "5", "8"],
    stories: [{ id: "s1", title: "Pay by phone" }],
    expected: ["Ana", "Bo"],
    dueDate: "2026-01-05",
    replies: [
      {
        id: "rp1",
        name: "Ana",
        votes: [{ storyId: "s1", card: "3" }],
        notes: [{ storyId: "s1", text: "Bank API" }],
        at: AT,
      },
    ],
    status: "open",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/** A round made now, with no due day: it keeps its names for 14 days. */
const fresh = () =>
  round({ id: "async_fresh", dueDate: undefined, createdAt: new Date().toISOString() });

const DAY = 24 * 60 * 60 * 1000;

/** Moves the clock `ms` on for `run`, as a later visit would see it. */
async function later<T>(ms: number, run: () => T | Promise<T>): Promise<T> {
  const at = Date.now() + ms;
  const RealDate = Date;
  vi.stubGlobal(
    "Date",
    class extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...((args.length ? args : [at]) as [number]));
      }
      static now() {
        return at;
      }
    }
  );
  try {
    return await run();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("expireStoredRounds", () => {
  it("closes an expired round: names and notes go, the cards stay", () => {
    const next = expireStoredRounds([round()]);
    expect(next).not.toBeNull();
    const [closed] = next!;
    expect(closed.status).toBe("closed");
    expect(closed.replies[0].votes).toEqual([{ storyId: "s1", card: "3" }]);
    expect(JSON.stringify(closed)).not.toMatch(/Ana|Bo|Bank API/);
  });

  it("changes nothing when no round has expired or needs repair", () => {
    const list = [
      fresh(),
      round({ id: "async_shut", status: "closed", expected: undefined, replies: [] }),
    ];
    expect(expireStoredRounds(list)).toBeNull();
    expect(expireStoredRounds(undefined)).toBeNull();
    expect(expireStoredRounds([])).toBeNull();
  });

  it("repairs a malformed row and keeps one it can't read, in place", () => {
    const unreadable = { id: "async_nodate", title: "x", status: "open" };
    const loose = { ...fresh(), id: "async_loose", replies: "none" };
    const next = expireStoredRounds([unreadable, loose, fresh()]);
    expect(next).not.toBeNull();
    expect(next![0]).toBe(unreadable);
    expect(next![1]).toMatchObject({ id: "async_loose", replies: [] });
    expect(next![2].id).toBe("async_fresh");
  });

  it("reads the day it is given", () => {
    const r = fresh();
    expect(expireStoredRounds([r], new Date(Date.now() + 5 * DAY))).toBeNull();
    expect(expireStoredRounds([r], new Date(Date.now() + 21 * DAY))?.[0].status).toBe("closed");
  });
});

/** A store with just what the watcher uses; `writes` are the watcher's own. */
function fakeStore(rounds: unknown[] | undefined, hydrated = true) {
  type State = { pokerAsyncRounds?: PokerAsyncRound[] };
  let state: State = { pokerAsyncRounds: rounds as PokerAsyncRound[] | undefined };
  let isHydrated = hydrated;
  const listeners = new Set<(s: State, p: State) => void>();
  const onHydrated = new Set<() => void>();
  const writes: PokerAsyncRound[][] = [];
  const put = (next: State) => {
    const prev = state;
    state = { ...state, ...next };
    listeners.forEach((l) => l(state, prev));
  };
  const store: AsyncRoundStore = {
    getState: () => state,
    setState: (partial) => {
      writes.push(partial.pokerAsyncRounds);
      put(partial);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    persist: {
      hasHydrated: () => isHydrated,
      onFinishHydration: (l) => {
        onHydrated.add(l);
        return () => onHydrated.delete(l);
      },
    },
  };
  return {
    store,
    writes,
    rounds: () => state.pokerAsyncRounds ?? [],
    /** Another device's rows arriving by sync, or an import. */
    sync: (next: unknown[]) => put({ pokerAsyncRounds: next as PokerAsyncRound[] }),
    hydrate: () => {
      isHydrated = true;
      onHydrated.forEach((l) => l());
    },
  };
}

/** A defer the test runs by hand, to see that nothing is written inside a setState. */
function manualDefer() {
  const queue: (() => void)[] = [];
  return {
    defer: (run: () => void) => {
      queue.push(run);
    },
    flush: () => {
      while (queue.length) queue.shift()!();
    },
    pending: () => queue.length,
  };
}

describe("watchAsyncRoundExpiry", () => {
  it("closes an expired round once the workspace has loaded, once", () => {
    const s = fakeStore([round(), fresh()]);
    const d = manualDefer();
    const stop = watchAsyncRoundExpiry(s.store, d.defer);
    // Deferred: nothing is written while the load is still running.
    expect(s.writes).toEqual([]);
    d.flush();
    expect(s.writes).toHaveLength(1);
    expect(s.rounds().map((r) => r.status)).toEqual(["closed", "open"]);
    expect(JSON.stringify(s.rounds()[0])).not.toMatch(/Ana|Bank API/);
    // The round still in its 14 days keeps them.
    expect(s.rounds()[1].replies[0].name).toBe("Ana");
    // Its own write reads back unchanged: no second check is queued.
    expect(d.pending()).toBe(0);
    stop();
  });

  it("waits for the workspace to load before reading it", () => {
    const s = fakeStore([round()], false);
    const d = manualDefer();
    const stop = watchAsyncRoundExpiry(s.store, d.defer);
    d.flush();
    expect(s.writes).toEqual([]);
    s.hydrate();
    d.flush();
    expect(s.rounds()[0].status).toBe("closed");
    stop();
  });

  it("closes an expired round that sync brings in later", () => {
    const s = fakeStore([fresh()]);
    const d = manualDefer();
    const stop = watchAsyncRoundExpiry(s.store, d.defer);
    d.flush();
    expect(s.writes).toEqual([]);
    s.sync([fresh(), round()]);
    expect(s.writes).toEqual([]);
    d.flush();
    expect(s.writes).toHaveLength(1);
    expect(s.rounds().map((r) => r.status)).toEqual(["open", "closed"]);
    stop();
  });

  it("closes a round that expires while the page is open, once it's back in view", async () => {
    const s = fakeStore([fresh()]);
    const d = manualDefer();
    const stop = watchAsyncRoundExpiry(s.store, d.defer);
    d.flush();
    expect(s.writes).toEqual([]);
    await later(21 * DAY, () => {
      document.dispatchEvent(new Event("visibilitychange"));
      d.flush();
    });
    expect(s.rounds()[0].status).toBe("closed");
    expect(JSON.stringify(s.rounds())).not.toMatch(/Ana|Bank API/);
    stop();
  });

  it("stops watching when asked", () => {
    const s = fakeStore([fresh()]);
    const d = manualDefer();
    const stop = watchAsyncRoundExpiry(s.store, d.defer);
    d.flush();
    stop();
    s.sync([round()]);
    document.dispatchEvent(new Event("visibilitychange"));
    d.flush();
    expect(s.writes).toEqual([]);
  });
});

describe("the workspace store", () => {
  it("closes an expired round on any page, writing it back once", async () => {
    await Promise.resolve(useWorkspaceStore.persist.rehydrate());
    let changes = 0;
    const unsubscribe = useWorkspaceStore.subscribe((curr, prev) => {
      if (curr.pokerAsyncRounds !== prev.pokerAsyncRounds) changes++;
    });
    try {
      useWorkspaceStore.setState({ pokerAsyncRounds: [round(), fresh()] });
      await vi.waitFor(() =>
        expect(useWorkspaceStore.getState().pokerAsyncRounds?.[0].status).toBe("closed")
      );
      const stored = useWorkspaceStore.getState().pokerAsyncRounds ?? [];
      expect(JSON.stringify(stored[0])).not.toMatch(/Ana|Bo|Bank API/);
      expect(stored[1].status).toBe("open");
      // A few ticks on, nothing more has been written: the set, then one write.
      await new Promise((r) => setTimeout(r, 30));
      expect(changes).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});
