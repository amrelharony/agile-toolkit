import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StoryMap } from "@/lib/stores/workspace-types";

/**
 * Planning Poker queue write-back: the host's accepted estimate goes back to
 * the Story Mapper card, found through the host's own queue entry by the
 * session story id it stamped. A forged or unknown id, or a browser with no
 * such queue entry (a guest's), changes nothing.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));

import {
  STORY_MAP_ID,
  pendingQueueItems,
  takeQueuedStories,
  takeQueuedStoriesById,
  writeBackPokerEstimate,
} from "@/lib/handoffs/poker-writeback";
import { POKER_LOG_ID, pokerQueueRoute } from "@/lib/handoffs/targets/poker-queue";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";

const ws = () => useWorkspaceStore.getState();
const log = () => ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID);
const card = (id: string) =>
  ws()
    .storyMaps?.find((m) => m.id === STORY_MAP_ID)
    ?.slices.flatMap((sl) => Object.values(sl.cards).flat())
    .find((c) => c.id === id);

function storyMap(): StoryMap {
  return {
    id: STORY_MAP_ID,
    steps: [{ id: "st1", name: "Browse" }],
    slices: [
      {
        id: "sl1",
        name: "MVP",
        cards: {
          st1: [
            { id: "c1", title: "Search products", description: "By name", color: "#00f0ff" },
            { id: "c2", title: "Filter by price", description: "", color: "#00f0ff" },
          ],
        },
      },
    ],
  };
}

/** Queue story-map card `id` the way its menu does. */
function queueCard(id: string, title: string): string {
  let links: HandoffLink[] = [];
  const link = sendHandoff(
    "poker-queue",
    { title, sourceRef: { tool: "story-mapper", id, doc: STORY_MAP_ID } },
    { getLinks: () => links, setLinks: (u) => (links = u(links)) }
  );
  return link!.targetId;
}

beforeEach(() => {
  useWorkspaceStore.setState({ storyMaps: [storyMap()], pokerEstimationLogs: [] });
});

describe("pulling queued stories into a session", () => {
  it("makes one session story per queued item and stamps its id on the item", () => {
    const q1 = queueCard("c1", "Search products");
    const q2 = queueCard("c2", "Filter by price");

    const stories = takeQueuedStories(["existing-story"]);
    expect(stories.map((s) => s.title)).toEqual(["Search products", "Filter by price"]);
    expect(stories.every((s) => s.finalEstimate === null)).toBe(true);
    const queue = log()!.queue!;
    expect(queue.find((q) => q.id === q1)!.sessionStoryId).toBe(stories[0].id);
    expect(queue.find((q) => q.id === q2)!.sessionStoryId).toBe(stories[1].id);

    // Nothing left to add to this session…
    expect(pendingQueueItems(queue, ["existing-story", ...stories.map((s) => s.id)])).toEqual([]);
    expect(takeQueuedStories(["existing-story", ...stories.map((s) => s.id)])).toEqual([]);
    // …but a new session (the old one ended) gets them again.
    expect(pendingQueueItems(queue, [])).toHaveLength(2);
  });

  it("never takes more than the session has room for", () => {
    queueCard("c1", "Search products");
    queueCard("c2", "Filter by price");
    expect(takeQueuedStories(Array.from({ length: 499 }, (_, i) => `s${i}`))).toHaveLength(1);
  });
});

describe("stories an async round holds", () => {
  it("takes only the chosen items by id, in queue order, and stamps only those", () => {
    const q1 = queueCard("c1", "Search products");
    const q2 = queueCard("c2", "Filter by price");
    const taken = takeQueuedStoriesById([q2, "unknown", q1]);
    expect(taken.map((s) => s.title)).toEqual(["Search products", "Filter by price"]);
    const queue = log()!.queue!;
    expect(queue.find((q) => q.id === q1)!.sessionStoryId).toBe(taken[0].id);
    expect(queue.find((q) => q.id === q2)!.sessionStoryId).toBe(taken[1].id);
    expect(takeQueuedStoriesById([])).toEqual([]);
  });

  it("leaves the items it didn't choose unstamped and pending", () => {
    const q1 = queueCard("c1", "Search products");
    const q2 = queueCard("c2", "Filter by price");
    takeQueuedStoriesById([q1]);
    const queue = log()!.queue!;
    expect(queue.find((q) => q.id === q2)!.sessionStoryId).toBeUndefined();
    expect(pendingQueueItems(queue).map((q) => q.id)).toContain(q2);
  });

  it("doesn't count or pull in a held item, so its round's write-back still matches", () => {
    const q1 = queueCard("c1", "Search products");
    const q2 = queueCard("c2", "Filter by price");
    const [held] = takeQueuedStoriesById([q1]);
    const queue = log()!.queue!;
    // Without the hold, a new session would take the stamped item again.
    expect(pendingQueueItems(queue).map((q) => q.id)).toEqual([q1, q2]);
    expect(pendingQueueItems(queue, [], [held.id]).map((q) => q.id)).toEqual([q2]);

    const pulled = takeQueuedStories([], undefined, [held.id]);
    expect(pulled.map((s) => s.title)).toEqual(["Filter by price"]);
    // The held item keeps the id its round knows it by.
    expect(log()!.queue!.find((q) => q.id === q1)!.sessionStoryId).toBe(held.id);

    const { item, written } = writeBackPokerEstimate({
      sessionStoryId: held.id,
      value: "5",
      scaleType: "fibonacci",
    });
    expect(item?.id).toBe(q1);
    expect(written).toBe(true);
    expect(card("c1")!.estimate).toBe("5");
  });

  it("keeps today's behaviour with the default, no items held", () => {
    queueCard("c1", "Search products");
    expect(takeQueuedStories([], undefined, [])).toHaveLength(1);
    expect(pendingQueueItems(log()!.queue!, [], [])).toHaveLength(1);
  });
});

describe("writing an accepted estimate back", () => {
  it("sets the card's estimate, logs it with its source and clears it from the queue", () => {
    const q1 = queueCard("c1", "Search products");
    queueCard("c2", "Filter by price");
    const [story] = takeQueuedStories();

    const result = writeBackPokerEstimate({
      sessionStoryId: story.id,
      value: "5",
      scaleType: "fibonacci",
      votes: ["3", "5", "5"],
    });

    expect(result.written).toBe(true);
    expect(result.item?.id).toBe(q1);
    expect(card("c1")?.estimate).toBe("5");
    expect(card("c2")?.estimate).toBeUndefined();
    expect(log()!.queue!.map((q) => q.sourceRef.id)).toEqual(["c2"]);
    expect(log()!.estimates).toEqual([
      {
        id: q1,
        storyTitle: "Search products",
        finalEstimate: "5",
        scaleType: "fibonacci",
        votes: ["3", "5", "5"],
        decidedAt: expect.any(String),
        sourceRef: { tool: "story-mapper", id: "c1", doc: STORY_MAP_ID },
        // The session story it was accepted for: the queue entry is gone now.
        sessionStoryId: story.id,
      },
    ]);
    // The card's "Sent · Open" link still finds its target.
    expect(pokerQueueRoute.exists(q1)).toBe(true);
  });

  it("ignores a forged or unknown story id", () => {
    const q1 = queueCard("c1", "Search products");
    takeQueuedStories();
    const before = JSON.stringify(useWorkspaceStore.getState());

    // An id that isn't a stamped session story id — including the queue
    // item's own id and the card's id — matches nothing.
    for (const sessionStoryId of ["forged", q1, "c1", ""]) {
      expect(
        writeBackPokerEstimate({ sessionStoryId, value: "8", scaleType: "fibonacci" })
      ).toEqual({ item: null, written: false });
    }
    expect(JSON.stringify(useWorkspaceStore.getState())).toBe(before);
    expect(card("c1")?.estimate).toBeUndefined();
  });

  it("does nothing in a browser whose queue doesn't hold the story (a guest's)", () => {
    queueCard("c1", "Search products");
    const [story] = takeQueuedStories();
    // A guest's browser: its own workspace, no queue.
    useWorkspaceStore.setState({ storyMaps: [storyMap()], pokerEstimationLogs: [] });

    expect(
      writeBackPokerEstimate({ sessionStoryId: story.id, value: "5", scaleType: "fibonacci" })
    ).toEqual({ item: null, written: false });
    expect(card("c1")?.estimate).toBeUndefined();
    expect(log()).toBeUndefined();
  });

  it("rejects an empty or oversized value", () => {
    queueCard("c1", "Search products");
    const [story] = takeQueuedStories();
    for (const value of ["", "   ", "x".repeat(33)]) {
      expect(
        writeBackPokerEstimate({ sessionStoryId: story.id, value, scaleType: "custom" }).item
      ).toBeNull();
    }
    expect(card("c1")?.estimate).toBeUndefined();
    expect(log()!.queue).toHaveLength(1);
  });

  it("is applied once: a second accept for the same story finds nothing", () => {
    queueCard("c1", "Search products");
    const [story] = takeQueuedStories();
    writeBackPokerEstimate({ sessionStoryId: story.id, value: "5", scaleType: "fibonacci" });
    expect(
      writeBackPokerEstimate({ sessionStoryId: story.id, value: "8", scaleType: "fibonacci" }).item
    ).toBeNull();
    expect(card("c1")?.estimate).toBe("5");
    expect(log()!.estimates).toHaveLength(1);
  });

  it("logs the estimate but writes nothing when the card was deleted", () => {
    queueCard("c1", "Search products");
    const [story] = takeQueuedStories();
    useWorkspaceStore.setState({
      storyMaps: [{ ...storyMap(), slices: [{ id: "sl1", name: "MVP", cards: { st1: [] } }] }],
    });
    const result = writeBackPokerEstimate({
      sessionStoryId: story.id,
      value: "5",
      scaleType: "fibonacci",
    });
    expect(result.written).toBe(false);
    expect(result.item).not.toBeNull();
    expect(log()!.estimates).toHaveLength(1);
    expect(log()!.queue).toEqual([]);
  });
});
