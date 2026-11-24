/**
 * Flow Insights' next steps (lib/flow/insights-steps, through the lazy
 * rule the base registered): repeat work in the latest finished sprint
 * from 5 items, a team change in it, and examples ignored.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getNextStepRule, loadNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type CapacityPlan,
  type Sprint,
  type Story,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { capacityPlanIdFor } from "@/lib/sprints/capacity";
import { flowInsightsSteps } from "@/lib/flow/insights-steps";

const sprint = (n: number, patch: Partial<Sprint> = {}): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: `2026-0${n}-02`,
  endDate: `2026-0${n}-13`,
  pointsPlanned: 20,
  status: "completed",
  ...patch,
});

const done = (id: string, sprintId: string, end: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  sprintId,
  doneAt: `${end}T12:00:00.000Z`,
  ...patch,
});

/** `n` stories done in sprint `s`, the first `failing` of them repeat work. */
const batch = (s: Sprint, n: number, failing: number, owner = "Ana"): Story[] =>
  Array.from({ length: n }, (_, i) =>
    done(`${s.id}-${i}`, s.id, s.endDate, {
      owner,
      ...(i < failing ? { title: `Fix thing ${i}` } : {}),
    })
  );

const steps = (ws: Partial<Workspace>): NextStep[] => {
  const rule = getNextStepRule("flow-insights")!;
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};
const ids = (ws: Partial<Workspace>) => steps(ws).map((s) => s.id);

beforeAll(async () => {
  await loadNextStepRule("flow-insights");
});

describe("Flow Insights' next steps", () => {
  it("sends 30% repeat work in the latest finished sprint to Root Cause", () => {
    const s1 = sprint(1);
    const s2 = sprint(2);
    const out = steps({ sprints: [s1, s2], stories: [...batch(s1, 5, 0), ...batch(s2, 10, 3)] });
    const failure = out.find((s) => s.id === "flow-insights-failure");
    expect(failure).toEqual({
      id: "flow-insights-failure",
      label: "Find the cause of the repeat work with Root Cause",
      detail: "3 of 10 items finished in Sprint 2 fixed or redid earlier work.",
      href: "/root-cause",
    });
  });

  it("waits for 5 finished items, and for 30%", () => {
    const s1 = sprint(1);
    expect(ids({ sprints: [s1], stories: batch(s1, 4, 4) })).not.toContain("flow-insights-failure");
    expect(ids({ sprints: [s1], stories: batch(s1, 10, 2) })).not.toContain(
      "flow-insights-failure"
    );
    expect(ids({ sprints: [s1], stories: batch(s1, 5, 2) })).toContain("flow-insights-failure");
  });

  it("reads only the latest finished sprint", () => {
    const s1 = sprint(1);
    const s2 = sprint(2);
    const s3 = sprint(3, { status: "active" });
    const out = ids({
      sprints: [s1, s2, s3],
      stories: [...batch(s1, 6, 6), ...batch(s2, 6, 0), ...batch(s3, 6, 6)],
    });
    expect(out).not.toContain("flow-insights-failure");
  });

  it("points at the release forecast after a team change in the latest sprint", () => {
    const s1 = sprint(1);
    const s2 = sprint(2);
    const plans: CapacityPlan[] = [s1, s2].map((s, i) => ({
      id: capacityPlanIdFor(s.id),
      sprintId: s.id,
      members: (i === 0 ? ["Ana", "Ben"] : ["Ana", "Cy"]).map((name) => ({
        id: name,
        name,
        role: "Dev",
        availability: 100,
        daysOff: 0,
      })),
      config: {
        sprintDays: 10,
        ceremonyOverhead: 10,
        focusFactor: 0.8,
        hoursPerDay: 6,
        pointsCommitted: "",
      },
    }));
    const change = steps({ sprints: [s1, s2], stories: [], capacityPlans: plans }).find(
      (s) => s.id === "flow-insights-team-change"
    );
    expect(change).toEqual({
      id: "flow-insights-team-change",
      label: "Check the release forecast after the team change",
      detail: "1 person joined and 1 left in Sprint 2. Forecasts lean on the sprints before it.",
      href: "/release-planner",
    });
    expect(
      ids({
        sprints: [s1, s2],
        stories: [],
        capacityPlans: [plans[0], { ...plans[1], members: plans[0].members, id: plans[1].id }],
      })
    ).not.toContain("flow-insights-team-change");
  });

  it("ignores example sprints and stories", () => {
    const ex = sprint(1, { id: "example-s1" });
    const stories = batch(ex, 6, 6).map((s) => ({ ...s, id: `example-${s.id}` }));
    expect(steps({ sprints: [ex], stories })).toEqual([]);
    expect(
      flowInsightsSteps({ stories: [], sprints: [], boards: undefined, plans: undefined })
    ).toEqual([]);
  });
});
