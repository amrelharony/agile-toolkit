import { describe, expect, it } from "vitest";
import { detectRiskStacking, detectTechDebtAcceleration } from "@/lib/analytics/anti-patterns";
import { buildWorkspaceContext } from "@/lib/ai-prompts/cross-tool-context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { buildExample as riskExample } from "@/app/(tools)/risk-register/example";
import { buildExample as debtExample } from "@/app/(tools)/tech-debt/example";
import type { Risk, TechDebtItem, Workspace } from "@/lib/stores/workspace-types";

/**
 * Since Phase 8 the Risk Register's and Tech Debt's "Load an example" save
 * their rows into workspace.risks / workspace.techDebt. Those rows
 * (example- ids) aren't the team's: the risk-stacking and debt
 * acceleration insights, and the workspace context every AI prompt gets,
 * leave them out, as the dashboard and the agents do.
 */

const workspace = (over: Partial<Workspace>): Workspace =>
  ({ ...useWorkspaceStore.getState(), ...over }) as unknown as Workspace;

const risk = (id: string, probability: number, impact: number): Risk => ({
  id,
  title: `Risk ${id}`,
  probability,
  impact,
  status: "open",
  raisedAt: "2026-10-01",
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const debt = (id: string, raisedDaysAgo: number): TechDebtItem => ({
  id,
  title: `Debt ${id}`,
  impact: 3,
  effort: 2,
  raisedAt: daysAgo(raisedDaysAgo),
});

describe("example rows in the insights", () => {
  it("an example-only register raises no risk-stacking signal", () => {
    const example = riskExample();
    // The example does hold three active high risks: they just aren't the team's.
    expect(example.filter((r) => r.probability * r.impact >= 10).length).toBeGreaterThanOrEqual(3);
    expect(detectRiskStacking(workspace({ risks: example }))).toBeNull();
  });

  it("counts only the team's high risks next to the example", () => {
    const own = [risk("a", 2, 5), risk("b", 4, 4), risk("c", 5, 3)];
    const signal = detectRiskStacking(workspace({ risks: [...riskExample(), ...own] }));
    expect(signal).toMatchObject({ title: "3 high-severity risks open" });
    expect(signal?.evidence).toEqual(["Risk a (P2×I5)", "Risk b (P4×I4)", "Risk c (P5×I3)"]);
  });

  it("the debt example doesn't push the team's recent debt over the acceleration threshold", () => {
    const own = [debt("d1", 3), debt("d2", 10)];
    expect(
      detectTechDebtAcceleration(workspace({ techDebt: [...debtExample(), ...own] }))
    ).toBeNull();
    // Three of the team's own in the last 30 days do raise it.
    expect(
      detectTechDebtAcceleration(workspace({ techDebt: [...debtExample(), ...own, debt("d3", 1)] }))
    ).toMatchObject({ id: "TECH_DEBT_ACCELERATING" });
  });

  it("the AI workspace context counts no example risk and quotes no signal from them", () => {
    const context = buildWorkspaceContext(workspace({ risks: riskExample() }));
    expect(context).not.toContain("Open risks");
    expect(context).not.toContain("high-severity risks open");
    expect(
      buildWorkspaceContext(workspace({ risks: [...riskExample(), risk("mine", 1, 1)] }))
    ).toContain("Open risks: 1");
  });
});
