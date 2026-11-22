/**
 * unsizedBacklog: the backlog stories Relative Sizing sizes together, and
 * the batch size that makes it worth it.
 */

import { describe, expect, it } from "vitest";
import { UNSIZED_BATCH_MIN, unsizedBacklog } from "@/lib/relative-sizing/unsized";
import type { Story } from "@/lib/stores/workspace-types";

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: id,
  status: "backlog",
  ...over,
});

describe("unsizedBacklog", () => {
  it("is five stories at least", () => {
    expect(UNSIZED_BATCH_MIN).toBe(5);
  });

  it("keeps the backlog's stories with no points, in order", () => {
    const stories = [
      story("a"),
      story("b", { points: 3 }),
      story("c", { status: "todo" }),
      story("d", { points: 0 }),
      story("e", { points: Number.NaN }),
    ];
    expect(unsizedBacklog(stories).map((s) => s.id)).toEqual(["a", "c", "e"]);
  });

  it("leaves out done stories, stories in a sprint and the example's", () => {
    const stories = [
      story("done", { status: "done" }),
      story("planned", { sprintId: "sprint_1" }),
      story("example-1"),
      story("kept"),
    ];
    expect(unsizedBacklog(stories).map((s) => s.id)).toEqual(["kept"]);
  });

  it("is empty for no stories", () => {
    expect(unsizedBacklog([])).toEqual([]);
  });
});
