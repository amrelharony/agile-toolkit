/**
 * Reading stored rounds without a meeting (lib/estimation/async-read). The
 * slice has no CRUD, so an imported workspace file can hold any shape: a
 * row the readers can't use is left out, a malformed list or field is
 * repaired within POKER_ASYNC_MAX, and a well-formed row reads back as the
 * same object. Then the queue hold, the reveal step, the Estimation Guide's
 * count and the store's import all take such a file without throwing.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/register", () => ({
  registerEntityCollection: () => {},
  registerBlobStore: () => {},
}));

import { readAsyncRounds, readPokerAsyncRound } from "@/lib/estimation/async-read";
import {
  asyncRevealSteps,
  heldQueueCount,
  heldStoryIds,
  readAsyncRound,
} from "@/lib/estimation/async-rounds";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { POKER_ASYNC_MAX, type PokerAsyncRound } from "@/lib/stores/workspace-types";

const AT = "2026-11-20T10:00:00.000Z";
const TODAY = "2026-11-23";

function round(over: Partial<PokerAsyncRound> = {}): PokerAsyncRound {
  return {
    id: "async_r1",
    title: "Checkout stories",
    scaleType: "fibonacci",
    deck: ["1", "2", "3", "5", "8"],
    stories: [
      { id: "s1", title: "Pay by phone" },
      { id: "s2", title: "Refund a payment", finalEstimate: "5" },
    ],
    expected: ["Ana", "Bo"],
    dueDate: "2026-11-21",
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

/** A round as a hand-edited or third-party file might hold it. */
const loose = (over: Record<string, unknown>) =>
  ({ ...round(), ...over }) as unknown as PokerAsyncRound;

describe("readPokerAsyncRound", () => {
  it("reads a well-formed round back as the same object", () => {
    const r = round();
    expect(readPokerAsyncRound(r)).toBe(r);
    const list = [r, round({ id: "async_r2", dueDate: undefined, expected: undefined })];
    expect(readAsyncRounds(list)).toBe(list);
  });

  it("leaves out a row with no id, no usable createdAt or an unknown status", () => {
    for (const bad of [
      null,
      "async_r1",
      [],
      loose({ id: undefined }),
      loose({ id: "" }),
      loose({ createdAt: undefined }),
      loose({ createdAt: "yesterday" }),
      loose({ createdAt: "2026-13-45T00:00:00Z" }),
      loose({ status: "done" }),
    ]) {
      expect(readPokerAsyncRound(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(readAsyncRounds([null, round(), { id: "x" }]).map((r) => r.id)).toEqual(["async_r1"]);
    expect(readAsyncRounds("lots")).toEqual([]);
    expect(readAsyncRounds(undefined)).toEqual([]);
  });

  it("gives missing lists as empty ones and keeps only well-formed entries", () => {
    const r = readPokerAsyncRound(
      loose({
        deck: "1,2,3",
        stories: [{ id: "s1", title: "Pay by phone" }, { title: "No id" }, null, { id: "s3" }],
        replies: undefined,
      })
    )!;
    expect(r.deck).toEqual([]);
    expect(r.stories).toEqual([{ id: "s1", title: "Pay by phone" }]);
    expect(r.replies).toEqual([]);
    // Every reader then works on it.
    expect(heldStoryIds([r])).toEqual(["s1"]);
    expect(readAsyncRound(r).status).toBe("open");
  });

  it("repairs a reply's votes and notes, and drops one with no name or time", () => {
    const r = readPokerAsyncRound(
      loose({
        replies: [
          {
            id: "rp1",
            name: "Ana",
            votes: [{ storyId: "s1", card: "3" }, { storyId: "s2" }, "8"],
            notes: "Bank API",
            at: AT,
          },
          { id: "rp2", votes: [], at: AT },
          { id: "rp3", name: "Bo", votes: [], at: 7 },
        ],
      })
    )!;
    expect(r.replies).toEqual([
      { id: "rp1", name: "Ana", votes: [{ storyId: "s1", card: "3" }], at: AT },
    ]);
  });

  it("keeps each list within POKER_ASYNC_MAX", () => {
    const stories = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `Story ${i}` }));
    const deck = Array.from({ length: 20 }, (_, i) => String(i));
    const r = readPokerAsyncRound(loose({ stories, deck }))!;
    expect(r.stories).toHaveLength(POKER_ASYNC_MAX.stories);
    expect(r.deck).toHaveLength(POKER_ASYNC_MAX.deck);
  });

  it("drops a bad due day, list of names or flag, and fills a missing title and stamp", () => {
    const r = readPokerAsyncRound(
      loose({
        dueDate: "next week",
        expected: "Ana",
        withMeanings: "yes",
        title: 42,
        updatedAt: undefined,
      })
    )!;
    expect(r).not.toHaveProperty("dueDate");
    expect(r).not.toHaveProperty("expected");
    expect(r).not.toHaveProperty("withMeanings");
    expect(r.title).toBe("");
    expect(r.updatedAt).toBe(AT);
    expect(readPokerAsyncRound(loose({ dueDate: "2026-02-30" }))).not.toHaveProperty("dueDate");
  });
});

describe("the readers take a malformed file without throwing", () => {
  const file = [
    round({ id: "async_ok", stories: [{ id: "held1", title: "Search" }] }),
    loose({ id: "async_nodate", createdAt: undefined }),
    loose({ id: "async_nolists", stories: undefined, replies: undefined, deck: undefined }),
    loose({ id: "async_badreplies", replies: [{ junk: true }], dueDate: "soon" }),
  ];

  it("holds the queue stories of the rounds it can read (Planning Poker, the Estimation Guide)", () => {
    // async_nodate can't be read; async_nolists holds none; async_badreplies keeps its stories.
    expect(heldStoryIds(file)).toEqual(["held1", "s1", "s2"]);
    const queue = [{ sessionStoryId: "held1" }, { sessionStoryId: "free" }, {}];
    expect(heldQueueCount(queue, file, new Date(`${TODAY}T12:00:00`))).toBe(1);
  });

  it("offers the reveal step only for a readable round ready to reveal", () => {
    // async_ok is due and has Ana's reply; the others can't be revealed.
    expect(asyncRevealSteps(file, TODAY).map((s) => s.id)).toEqual(["poker-async-reveal-async_ok"]);
  });
});

describe("importing a workspace file", () => {
  beforeAll(async () => {
    await Promise.resolve(useWorkspaceStore.persist.rehydrate());
  });
  beforeEach(() => useWorkspaceStore.getState().resetWorkspace());

  it("leaves out a round it can't read and repairs the rest", () => {
    const ok = round({ id: "async_ok" });
    useWorkspaceStore.getState().importJSON(
      JSON.stringify({
        pokerAsyncRounds: [
          ok,
          { id: "async_nodate", title: "x", status: "open", stories: [], replies: [] },
          { ...ok, id: "async_nolists", stories: undefined, replies: "none" },
        ],
      })
    );
    const stored = useWorkspaceStore.getState().pokerAsyncRounds ?? [];
    expect(stored.map((r) => r.id)).toEqual(["async_ok", "async_nolists"]);
    expect(stored[0]).toEqual(ok);
    expect(stored[1]).toMatchObject({ stories: [], replies: [] });
  });
});
