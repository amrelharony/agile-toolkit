/**
 * lib/okrs/links: a goal's linked OKRs resolved (Sprint Goal's side), and
 * the sprint goals that link one objective (the OKR Tracker's side).
 */

import { describe, expect, it } from "vitest";
import type { Okr, Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { resolveLinkedOkrs, sprintGoalsFor } from "@/lib/okrs/links";
import { sprintGoalsFor as fromProgress } from "@/lib/okrs/progress";
import * as pageLinks from "@/app/(tools)/sprint-goal/okr-links";
import { DRAFT_GOAL_ID, blankGoal } from "@/lib/sprints/goal-doc";
import { exampleId } from "@/lib/utils/example-id";

const sprint = (id: string, name: string, startDate: string): Sprint => ({
  id,
  name,
  startDate,
  endDate: startDate,
  pointsPlanned: 0,
  status: "completed",
});

const goal = (sprintId: string | null, okrIds: string[], patch: Partial<SprintGoal> = {}) => ({
  ...blankGoal(sprintId),
  okrIds,
  ...patch,
});

const okr = (id: string): Okr => ({ id, objective: id, quarter: "2026 Q4", keyResults: [] });

describe("resolveLinkedOkrs", () => {
  it("resolves each linked id once and reports deleted ones", () => {
    const okrs = [okr("o1"), okr("o2")];
    expect(resolveLinkedOkrs(["o2", "gone", "o2"], okrs)).toEqual({
      linked: [okrs[1]],
      missing: ["gone"],
    });
    expect(resolveLinkedOkrs(undefined, okrs)).toEqual({ linked: [], missing: [] });
  });

  it("is what Sprint Goal's okr-links re-exports", () => {
    expect(pageLinks.resolveLinkedOkrs).toBe(resolveLinkedOkrs);
  });
});

describe("sprintGoalsFor", () => {
  const sprints = [
    sprint("s2", "Sprint 2", "2026-09-15"),
    sprint("s1", "Sprint 1", "2026-09-01"),
    sprint(exampleId("s3"), "Example sprint", "2026-08-01"),
  ];
  const goals: SprintGoal[] = [
    goal("s2", ["o1"], {
      goal: "Shoppers reorder in one tap",
      outcome: { met: "met", decidedAt: "2026-09-28" },
    }),
    goal(null, ["o1"]),
    goal("s1", ["o1", "o2"], { goal: "Guest checkout in beta" }),
    goal("gone", ["o1"]),
    goal(exampleId("s3"), ["o1"]),
    goal("s1", ["o3"], { id: "sprint-goal:other" }),
  ];

  it("lists the goals that link the objective, oldest sprint first and the draft last", () => {
    expect(sprintGoalsFor("o1", goals, sprints)).toEqual([
      {
        goalId: "sprint-goal:sprint:s1",
        sprintId: "s1",
        sprintName: "Sprint 1",
        goal: "Guest checkout in beta",
      },
      {
        goalId: "sprint-goal:sprint:s2",
        sprintId: "s2",
        sprintName: "Sprint 2",
        goal: "Shoppers reorder in one tap",
        met: "met",
      },
      { goalId: DRAFT_GOAL_ID, sprintId: null, sprintName: "Draft goal", goal: "" },
    ]);
  });

  it("leaves out a deleted sprint's goal and an example sprint's", () => {
    const ids = sprintGoalsFor("o1", goals, sprints).map((l) => l.sprintId);
    expect(ids).not.toContain("gone");
    expect(ids).not.toContain(exampleId("s3"));
  });

  it("is empty for an objective nothing links", () => {
    expect(sprintGoalsFor("o9", goals, sprints)).toEqual([]);
    expect(sprintGoalsFor("o2", goals, sprints).map((l) => l.sprintName)).toEqual(["Sprint 1"]);
  });

  it("is the same function from lib/okrs/progress", () => {
    expect(fromProgress).toBe(sprintGoalsFor);
  });
});
