import { describe, expect, it } from "vitest";
import type { Story } from "@/lib/stores/workspace-types";
import {
  backlogByPriority,
  selectStoriesForCapacity,
  storyPoints,
  totalStoryPoints,
} from "@/lib/sprints/plan";

const story = (
  id: string,
  points?: number,
  priorityScore?: number,
  status: Story["status"] = "backlog"
): Story => ({ id, title: id, status, points, priorityScore });

const BACKLOG = [
  story("a", 5, 10),
  story("b", 3, 8),
  story("c", 8, 9),
  story("unsized", undefined, 20),
  story("unscored", 2),
  story("in-sprint", 5, 7, "todo"),
];

describe("selectStoriesForCapacity", () => {
  it("takes backlog stories by priority while they fit, skipping unsized ones", () => {
    const { selected, totalPoints, remaining } = selectStoriesForCapacity(BACKLOG, 10);
    expect(selected.map((s) => s.id)).toEqual(["a", "b", "unscored"]);
    expect(totalPoints).toBe(10);
    expect(remaining).toBe(0);
  });

  it("agrees with the agent's original loop", () => {
    // intent.plan_sprint before it shared this module.
    const candidates = BACKLOG.filter((s) => s.status === "backlog")
      .slice()
      .sort((a, b) => (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity));
    for (const capacity of [0, 3, 7, 10, 13, 100]) {
      const selected: Story[] = [];
      let remaining = capacity;
      for (const s of candidates) {
        const pts = s.points ?? 0;
        if (pts <= 0 || pts > remaining) continue;
        selected.push(s);
        remaining -= pts;
      }
      const ours = selectStoriesForCapacity(BACKLOG, capacity);
      expect(
        ours.selected.map((s) => s.id),
        `capacity ${capacity}`
      ).toEqual(selected.map((s) => s.id));
      expect(ours.totalPoints).toBe(capacity - remaining);
    }
  });

  it("returns nothing for no capacity or a bad number", () => {
    expect(selectStoriesForCapacity(BACKLOG, 0).selected).toEqual([]);
    expect(selectStoriesForCapacity(BACKLOG, Number.NaN).selected).toEqual([]);
  });
});

describe("points", () => {
  it("counts only finite points and sums to a tenth", () => {
    expect(storyPoints(story("x"))).toBe(0);
    expect(storyPoints(story("x", 2.5))).toBe(2.5);
    expect(totalStoryPoints([story("a", 5), story("b", 2.5), story("c")])).toBe(7.5);
  });

  it("orders the backlog by score with unscored stories last", () => {
    expect(backlogByPriority(BACKLOG).map((s) => s.id)).toEqual([
      "unsized",
      "a",
      "c",
      "b",
      "unscored",
    ]);
  });
});
