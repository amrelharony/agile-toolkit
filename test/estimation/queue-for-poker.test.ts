/**
 * The Planning Poker queue helper, moved from Refinement to
 * lib/estimation/queue-for-poker.ts (Refinement re-exports it): one story
 * or many go to the queue named as stories, a story already queued is
 * skipped, and one Undo takes a batch back.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const undo = vi.hoisted(() => ({ all: [] as { apply: () => void; revert: () => void }[] }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

import { queueAllForPoker, queueForPoker, queuedStoryIds } from "@/lib/estimation/queue-for-poker";
import * as refinement from "@/app/(tools)/refinement/poker";
import { currentPokerLog } from "@/lib/handoffs/targets/poker-queue";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "backlog",
  ...over,
});
const queued = () => queuedStoryIds(currentPokerLog());

beforeEach(() => {
  undo.all = [];
  useWorkspaceStore.setState({ stories: [story("a"), story("b")], pokerEstimationLogs: [] });
});

describe("queue-for-poker", () => {
  it("is what Refinement re-exports", () => {
    expect(refinement.queueAllForPoker).toBe(queueAllForPoker);
    expect(refinement.queueForPoker).toBe(queueForPoker);
    expect(refinement.queuedStoryIds).toBe(queuedStoryIds);
  });

  it("queues one story once", () => {
    expect(queueForPoker(story("a"))).toBe(true);
    expect(Array.from(queued())).toEqual(["a"]);
    expect(queueForPoker(story("a"))).toBe(false);
  });

  it("queues many with one Undo, skipping the ones already queued", () => {
    queueForPoker(story("a"));
    expect(queueAllForPoker([story("a"), story("b"), story("c", { title: " " })])).toBe(1);
    expect(Array.from(queued()).sort()).toEqual(["a", "b"]);
    undo.all.at(-1)!.revert();
    expect(Array.from(queued())).toEqual(["a"]);
    expect(queueAllForPoker([story("a")])).toBe(0);
  });
});
