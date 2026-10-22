import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { sprintReport, type SprintReportInput } from "@/lib/sprints/report";

const SPRINT: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};
const SERIES: SprintSeries = {
  id: "s2",
  days: [
    { day: 0, remaining: 30 },
    { day: 2, remaining: 27 },
  ],
};

const full: SprintReportInput = {
  sprint: SPRINT,
  series: SERIES,
  sprints: [SPRINT],
  today: "2026-10-19",
  stories: [
    { id: "a", title: "Save a card", points: 8, status: "done", sprintId: "s2" },
    { id: "b", title: "Pay | with a saved card", points: 5, status: "done", sprintId: "s2" },
    { id: "c", title: "Refund flow", points: 8, status: "todo", sprintId: "s2", owner: "Chloé" },
  ],
  openImpediments: [
    {
      id: "i1",
      title: "Sandbox returns 500s",
      severity: "high",
      raisedAt: "2026-10-17T09:00:00.000Z",
      owner: "Ben",
    },
  ],
  standup: { posted: 3, members: 5, blockers: 1 },
  retroActions: [
    { text: "Pair on flaky tests", assignee: "Sam" },
    { text: "Shorter planning", assignee: "" },
  ],
  review: {
    demoItems: [{ name: "Saved cards", timeMinutes: 10 }],
    feedback: [{ stakeholder: "Priya", feedback: "Love the refund flow", category: "positive" }],
  },
};

describe("sprintReport", () => {
  it("starts with the Sprint Metrics summary and adds what the other tools know", () => {
    const md = sprintReport(full);
    expect(md.startsWith("# Sprint 2\n")).toBe(true);
    expect(md).toContain("**Goal:** Checkout works end to end");
    expect(md).toContain("## Where it stands");
    expect(md).toContain("## Daily log");

    expect(md).toContain("## Sprint backlog");
    expect(md).toContain("2 of 3 stories done · 13 of 21 points.");
    expect(md).toContain("| Pay \\| with a saved card | 5 | Done |  |");
    expect(md).toContain("| Refund flow | 8 | To do | Chloé |");

    expect(md).toContain("## Daily Scrum today\n\n3 of 5 updated today, 1 with a blocker.");
    expect(md).toContain("| Sandbox returns 500s | High | 2026-10-17 | Ben |");
    expect(md).toContain("- Pair on flaky tests — Owner: Sam");
    expect(md).toContain("- Shorter planning — No owner yet");
    expect(md).toContain("**Demo:**\n- Saved cards (10 min)");
    expect(md).toContain("- Priya (positive): Love the refund flow");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("says plainly when a section has nothing yet", () => {
    const md = sprintReport({
      ...full,
      stories: [],
      openImpediments: [],
      standup: { posted: 0, members: 0, blockers: 0 },
      retroActions: [],
      review: null,
    });
    expect(md).toContain("No stories planned into this sprint.");
    expect(md).toContain("No updates posted yet today.");
    expect(md).toContain("Nothing open.");
    expect(md).toContain("No open actions.");
    expect(md).toContain("No demo script or feedback recorded yet.");
  });
});
