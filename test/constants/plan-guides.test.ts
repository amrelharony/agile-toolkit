import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/tools/guides/plan";
import type { ToolGuide } from "@/lib/tools/guides";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { velocity } from "@/lib/sprints/metrics";
import { SCHEDULE_LABEL } from "@/lib/roadmap/rollup";
import type { Story } from "@/lib/stores/workspace-types";
import { STATE_LABEL } from "@/app/(tools)/refinement/markdown";
import { readinessState } from "@/app/(tools)/refinement/session";
import type { Criterion } from "@/app/(tools)/refinement/store";
import { planRelease } from "@/app/(tools)/release-planner/plan";

/*
 * The Plan guides name on-screen labels and the rules behind them. These
 * lock the lines a review found out of step with the pages, checked against
 * the code's own labels and rules where it exports them, so a renamed badge
 * or a changed minimum fails here instead of leaving the guide wrong.
 */

function guide(id: string): ToolGuide {
  const found = GUIDES.find((g) => g.toolId === id);
  if (!found) throw new Error(`No Plan guide for ${id}`);
  return found;
}

const allText = (g: ToolGuide) => [...g.steps, ...(g.tips ?? [])].join("\n");

describe("Plan guides match their pages", () => {
  it("Refinement's Readiness scale: Ready needs the Mark ready call, not just the ticks", () => {
    const scale = guide("refinement").scales?.find((s) => s.name === "Readiness");
    const meaning = Object.fromEntries((scale?.values ?? []).map((v) => [v.value, v.meaning]));
    // One line per badge, under the badge's own words.
    expect(Object.keys(meaning).sort()).toEqual(Object.values(STATE_LABEL).sort());

    // Sized, every box ticked, but only kept with Save checks: the badge says Partial.
    const criteria: Criterion[] = [
      { id: "c1", label: "Acceptance criteria defined" },
      { id: "c2", label: "Fits in a sprint" },
    ];
    const saved: Story = {
      id: "s1",
      title: "Story s1",
      status: "backlog",
      points: 3,
      readiness: { checked: ["c1", "c2"], ready: false, updatedAt: "2026-10-20T10:00:00.000Z" },
    };
    expect(STATE_LABEL[readinessState(saved, criteria)]).toBe("Partial");
    expect(meaning.Partial).toMatch(/all criteria met, not marked ready/);
    expect(meaning.Ready).toMatch(/^marked ready/);
  });

  it("Release Planner's minimum counts typed velocities as well as completed sprints", () => {
    const typed = Array.from({ length: MIN_SAMPLE.forecast }, () => 10);
    const plan = planRelease({
      scope: { source: "typed", points: 50, items: 0, unestimated: 0 },
      scopeChangePct: null,
      velocitySource: "manual",
      sample: { points: typed, labels: typed.map((_, i) => `Sprint ${i + 1}`) },
      // No completed sprint at all: the typed numbers are the whole sample.
      headline: velocity([]),
      lengthDays: 14,
      lengthFrom: "cadence",
      start: { date: "2027-01-04", from: "user" },
      targetDate: "",
      targetFrom: null,
    });
    expect(plan.blocked).toBeNull();
    expect(plan.forecast).not.toBeNull();
    expect(allText(guide("release-planner"))).toContain(
      `at least ${MIN_SAMPLE.forecast} sprints of velocity, completed or typed`
    );
  });

  it("PI Planning and the Dependency Map call the date field Due, as the forms do", () => {
    for (const id of ["pi-planning", "dependency-map"]) {
      const text = allText(guide(id));
      expect(text, id).not.toMatch(/Due date/);
      expect(text, id).toMatch(/the date it's Due/);
    }
  });

  it("Epic Roadmap puts the schedule on the Epics rows and Fit to epics after a view change", () => {
    const { steps } = guide("epic-roadmap");
    const epics = steps.find((s) => s.startsWith("Under Epics")) ?? "";
    const roadmap = steps.find((s) => s.startsWith("Under Roadmap")) ?? "";
    const named = ["Under way", "Past its end quarter"];
    expect(Object.values(SCHEDULE_LABEL)).toEqual(expect.arrayContaining(named));
    for (const label of named) {
      expect(epics).toContain(label);
      expect(roadmap).not.toContain(label);
    }
    // The button shows only once View from or View to has been changed.
    expect(roadmap).toMatch(/Fit to epics then puts the view back/);
  });
});
