/**
 * Regression for two history-sync bugs:
 *  - B2: the pull cursor must track the newest SERVER `created_at`, never the
 *    client wall-clock (clock skew otherwise skips events on reconnect backfill).
 *  - B3: the bootstrap pull must fetch the NEWEST rows (created_at DESC), not
 *    the oldest, so accounts with > PULL_LIMIT events don't hide everything new.
 */

import { describe, it, expect, vi } from "vitest";
import type { HistoryEvent } from "@/lib/history/types";

const h = vi.hoisted(() => ({
  orderArgs: null as null | [string, { ascending: boolean }],
  limit: 0,
}));

vi.mock("@/lib/auth/supabase-browser", () => {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    order: (col: string, opts: { ascending: boolean }) => {
      h.orderArgs = [col, opts];
      return builder;
    },
    limit: (n: number) => {
      h.limit = n;
      return builder;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };
  return { getAuthBrowserClient: () => ({ from: () => builder }) };
});

import { pullEvents, nextPullCursor, PULL_LIMIT } from "@/lib/history/sync";

const ev = (clientEventId: string, syncedAt: string | undefined): HistoryEvent =>
  ({
    id: clientEventId,
    clientEventId,
    clientId: "c",
    toolRunId: "r",
    userId: "u",
    squadProfileId: null,
    toolId: "t",
    action: "a",
    payload: {},
    isMilestone: false,
    occurredAt: "2026-01-01T00:00:00.000Z",
    syncedAt,
  }) as HistoryEvent;

describe("nextPullCursor (B2)", () => {
  it("returns prev unchanged when nothing was pulled", () => {
    expect(nextPullCursor([], "2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
    expect(nextPullCursor([], null)).toBeNull();
  });

  it("returns the newest server created_at among pulled events", () => {
    const events = [
      ev("a", "2026-01-01T10:00:00.000Z"),
      ev("b", "2026-01-01T12:00:00.000Z"),
      ev("c", "2026-01-01T11:00:00.000Z"),
    ];
    expect(nextPullCursor(events, null)).toBe("2026-01-01T12:00:00.000Z");
  });

  it("never moves the cursor backward", () => {
    const events = [ev("a", "2026-01-01T09:00:00.000Z")];
    // prev is already newer than anything pulled → keep prev.
    expect(nextPullCursor(events, "2026-01-01T12:00:00.000Z")).toBe("2026-01-01T12:00:00.000Z");
  });

  it("ignores events with missing/invalid syncedAt", () => {
    const events = [ev("a", undefined), ev("b", "not-a-date"), ev("c", "2026-01-01T08:00:00.000Z")];
    expect(nextPullCursor(events, null)).toBe("2026-01-01T08:00:00.000Z");
  });

  it("does NOT use the client wall-clock", () => {
    const events = [ev("a", "2020-01-01T00:00:00.000Z")];
    const cursor = nextPullCursor(events, null);
    // The cursor is the (old) server timestamp, not ~now.
    expect(cursor).toBe("2020-01-01T00:00:00.000Z");
    expect(Date.parse(cursor!)).toBeLessThan(Date.now());
  });
});

describe("pullEvents bootstrap order (B3)", () => {
  it("fetches newest-first (created_at descending), capped at PULL_LIMIT", async () => {
    await pullEvents("user-1", null);
    expect(h.orderArgs).toEqual(["created_at", { ascending: false }]);
    expect(h.limit).toBe(PULL_LIMIT);
  });
});
