/**
 * unsizedBacklog: the backlog stories Relative Sizing sizes together, and
 * the batch size that makes it worth it. It counts the stories Refinement
 * lists as unsized, so the two pages always give the same number.
 */

import { describe, expect, it } from "vitest";
import { isBacklogUnsized } from "@/app/(tools)/refinement/session";
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

  it("keeps the backlog's stories with no points above 0, in order", () => {
    const stories = [
      story("a"),
      story("b", { points: 3 }),
      story("c", { points: 0 }),
      story("d", { points: Number.NaN }),
      story("e", { points: 0.5 }),
    ];
    expect(unsizedBacklog(stories).map((s) => s.id)).toEqual(["a", "c", "d"]);
  });

  it("leaves out work that has started or is done, stories in a sprint and the example's", () => {
    const stories = [
      story("todo", { status: "todo" }),
      story("doing", { status: "in_progress" }),
      story("review", { status: "review" }),
      story("done", { status: "done" }),
      story("planned", { sprintId: "sprint_1" }),
      story("example-1"),
      story("kept"),
    ];
    expect(unsizedBacklog(stories).map((s) => s.id)).toEqual(["kept"]);
  });

  it("counts the stories Refinement lists as unsized", () => {
    // Four backlog stories with no points, two at 0 points, and one in
    // progress on the flow board with no sprint and no points: Refinement
    // lists six, so the link and next step say six.
    const stories = [
      ...["a", "b", "c", "d"].map((id) => story(id)),
      story("zero-1", { points: 0 }),
      story("zero-2", { points: 0 }),
      story("flow", { status: "in_progress" }),
      story("sized", { points: 5 }),
      story("sprint", { status: "todo", sprintId: "sprint_1" }),
    ];
    expect(unsizedBacklog(stories)).toEqual(stories.filter(isBacklogUnsized));
    expect(unsizedBacklog(stories)).toHaveLength(6);
  });

  it("is empty for no stories", () => {
    expect(unsizedBacklog([])).toEqual([]);
  });
});
