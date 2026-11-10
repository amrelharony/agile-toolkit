import { describe, expect, it } from "vitest";
import type { BacklogItem, PrioritizationItem, Sprint, Story } from "@/lib/stores/workspace-types";
import { BACKLOG_DEFAULTS } from "@/lib/prioritization/frameworks";
import {
  backlogStories,
  importCandidates,
  planLine,
  planWarnings,
  priorityScore,
  sprintStories,
  storyFromBacklogItem,
} from "@/app/(tools)/sprint-planning/view";

const item = (name: string, patch: Partial<BacklogItem> = {}): BacklogItem => ({
  ...BACKLOG_DEFAULTS,
  id: name,
  name,
  ...patch,
});

const SPRINT: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works",
  pointsPlanned: 0,
  status: "planned",
};

describe("priorityScore", () => {
  it("is WSJF: cost of delay over job size", () => {
    expect(
      priorityScore(
        item("a", { businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 4 })
      )
    ).toBe(4);
    // Phase 7: a job size of 0 is Not scored (it was floored at 1), and a
    // legacy 0 < size < 1 divides by 1, the WSJF tool's and the hub's floor.
    expect(
      priorityScore(
        item("b", { businessValue: 2, timeCriticality: 1, riskReduction: 1, jobSize: 0 })
      )
    ).toBeNull();
    expect(
      priorityScore(
        item("c", { businessValue: 2, timeCriticality: 1, riskReduction: 1, jobSize: 0.5 })
      )
    ).toBe(4);
  });

  it("reads a WSJF row linked before Phase 7, as the Prioritizer does", () => {
    // Every WSJF part still at the old default (never saved since), the
    // row re-scored in the tool: (8 + 3 + 2) ÷ 1.
    const legacy: BacklogItem = {
      id: "old",
      name: "Checkout",
      ...{ businessValue: 5, timeCriticality: 5, riskReduction: 5, jobSize: 5 },
    };
    const rows: PrioritizationItem[] = [
      {
        id: "w1",
        framework: "wsjf",
        title: "Checkout",
        fields: { businessValue: 8, timeCriticality: 3, rrOe: 2, jobSize: 1 },
        backlogItemId: "old",
        updatedAt: "2026-10-01T09:00:00.000Z",
      },
    ];
    expect(priorityScore(legacy)).toBeNull();
    expect(priorityScore(legacy, rows)).toBe(13);
    expect(storyFromBacklogItem(legacy, "s1", rows).priorityScore).toBe(13);
  });
});

describe("stories", () => {
  const stories: Story[] = [
    { id: "done", title: "Done one", status: "done", sprintId: "s2", points: 3 },
    { id: "todo", title: "Open one", status: "todo", sprintId: "s2", points: 5 },
    { id: "other", title: "Elsewhere", status: "todo", sprintId: "s1", points: 5 },
    { id: "b-low", title: "Low", status: "backlog", priorityScore: 1 },
    { id: "b-high", title: "High", status: "backlog", priorityScore: 9, points: 8 },
    { id: "b-none", title: "Unscored", status: "backlog" },
  ];

  it("lists the sprint's stories with done ones last", () => {
    expect(sprintStories(stories, "s2").map((s) => s.id)).toEqual(["todo", "done"]);
  });

  it("lists the backlog by priority, unscored last", () => {
    expect(backlogStories(stories).map((s) => s.id)).toEqual(["b-high", "b-low", "b-none"]);
  });

  it("offers backlog items that have no story of the same name yet", () => {
    const items = [item("Open one"), item("  open   ONE "), item("Refund flow"), item("   ")];
    expect(importCandidates(items, stories).map((i) => i.name)).toEqual(["Refund flow"]);
  });

  it("turns a backlog item into a scored backlog story", () => {
    const s = storyFromBacklogItem(
      item("Refund flow", { businessValue: 9, timeCriticality: 6, riskReduction: 3, jobSize: 3 }),
      "story_1"
    );
    expect(s).toEqual({
      id: "story_1",
      title: "Refund flow",
      status: "backlog",
      priorityScore: 6,
      // Phase 7: a story pulled from the backlog links back to its item.
      sourceRef: { tool: "prioritizer", id: "Refund flow" },
    });
  });

  it("keeps the backlog item's description as the story's notes", () => {
    const s = storyFromBacklogItem(
      item("Refund flow", { description: "  Within 30 days.\r\nNo partial refunds.  " }),
      "story_1"
    );
    expect(s.notes).toBe("Within 30 days.\nNo partial refunds.");
    expect(
      storyFromBacklogItem(item("Long", { description: "d".repeat(3000) }), "s").notes
    ).toHaveLength(2000);
    expect("notes" in storyFromBacklogItem(item("Blank", { description: "  " }), "s")).toBe(false);
  });

  it("describes the plan in one line", () => {
    expect(planLine([])).toBe("0 stories · 0 points");
    expect(planLine([stories[1]])).toBe("1 story · 5 points");
  });
});

describe("planWarnings", () => {
  const inSprint: Story[] = [
    { id: "a", title: "A", status: "todo", sprintId: "s2", points: 8 },
    { id: "b", title: "B", status: "todo", sprintId: "s2" },
  ];

  it("flags the empty plan and the missing goal", () => {
    const w = planWarnings({
      sprint: { ...SPRINT, goal: "" },
      stories: [],
      targetPoints: 20,
      otherActive: [],
    });
    expect(w.map((x) => x.id)).toEqual(["empty", "no-goal"]);
  });

  it("flags over-commitment, unsized stories and another active sprint", () => {
    const w = planWarnings({
      sprint: SPRINT,
      stories: [...inSprint, { id: "c", title: "C", status: "todo", sprintId: "s2", points: 20 }],
      targetPoints: 20,
      otherActive: [{ ...SPRINT, id: "s1", name: "Sprint 1", status: "active" }],
    });
    expect(w.map((x) => x.id)).toEqual(["over-capacity", "unestimated", "another-active"]);
    expect(w[0].text).toBe("28 points planned against a capacity of 20: more than 10% over.");
    expect(w[1].text).toContain("1 story has no points");
    expect(w[2].text).toContain("Sprint 1 is still active");
  });

  it("is quiet for a sized plan within capacity", () => {
    expect(
      planWarnings({ sprint: SPRINT, stories: [inSprint[0]], targetPoints: 8.5, otherActive: [] })
    ).toEqual([]);
    // No target: nothing to compare against.
    expect(
      planWarnings({ sprint: SPRINT, stories: [inSprint[0]], targetPoints: null, otherActive: [] })
    ).toEqual([]);
  });
});
