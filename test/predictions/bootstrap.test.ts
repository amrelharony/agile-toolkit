/**
 * lib/predictions/bootstrap: the Tech Debt interest suggestion and the
 * Risk Register's mitigation lead time read the team's own rows only (an
 * example's made-up ones are left out), and with nothing to go on the
 * interest predictor suggests nothing rather than a made-up default.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Risk, TechDebtItem, Workspace } from "@/lib/stores/workspace-types";
import { bootstrapPredictions } from "@/lib/predictions/bootstrap";
import { lookupPredictor, type PredictResult } from "@/lib/predictions/registry";

const workspace = (over: Partial<Workspace>): Workspace => ({
  teamMembers: [],
  sprints: [],
  stories: [],
  impediments: [],
  risks: [],
  okrs: [],
  decisions: [],
  techDebt: [],
  ...over,
});

const predict = (toolId: string, field: string, over: Partial<Workspace>) =>
  lookupPredictor(toolId, field)!({
    workspace: workspace(over),
    history: [],
  }) as PredictResult<number>;

const debt = (id: string, interestRate?: number): TechDebtItem => ({
  id,
  title: id,
  impact: 3,
  effort: 3,
  raisedAt: "2026-10-01",
  ...(interestRate === undefined ? {} : { interestRate }),
});

const closedRisk = (id: string, days: number): Risk => ({
  id,
  title: id,
  probability: 3,
  impact: 3,
  status: "closed",
  raisedAt: "2026-10-01",
  resolvedAt: `2026-10-${String(1 + days).padStart(2, "0")}`,
});

beforeAll(() => bootstrapPredictions());

describe("the tech-debt interest suggestion", () => {
  it("suggests nothing without an estimate above 0: no made-up default", () => {
    expect(predict("tech-debt", "interestRate", {}).confidence).toBe("none");
    const unestimated = [debt("a"), debt("b", 0)];
    expect(predict("tech-debt", "interestRate", { techDebt: unestimated })).toEqual({
      value: 0,
      confidence: "none",
    });
  });

  it("is the mean of the team's own estimates, the example's left out", () => {
    const example = [1, 2, 3, 4, 5].map((n) => debt(`example-debt-${n}`, 9));
    expect(predict("tech-debt", "interestRate", { techDebt: example }).confidence).toBe("none");
    expect(
      predict("tech-debt", "interestRate", { techDebt: [...example, debt("a", 1), debt("b", 2)] })
    ).toEqual({ value: 1.5, confidence: "low", source: "Mean across 2 prior tech-debt items" });
  });
});

describe("the risk mitigation lead time", () => {
  it("reads the team's closed risks only, from 3", () => {
    const example = [2, 4, 6, 8].map((d) => closedRisk(`example-risk-${d}`, d));
    expect(predict("risk-register", "mitigationDays", { risks: example }).confidence).toBe("none");
    const own = [closedRisk("a", 4), closedRisk("b", 6), closedRisk("c", 8)];
    expect(
      predict("risk-register", "mitigationDays", { risks: [...example, ...own] })
    ).toMatchObject({ value: 6, confidence: "medium", source: "Median across 3 closed risks" });
  });
});
