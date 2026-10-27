/**
 * The Tech Debt page's old blob moving into workspace.techDebt
 * (lib/tech-debt/legacy), the Risk Register's move with debt fields: adds,
 * gap fills, the later status (resolved), conflicts reported, a row saved
 * since the upgrade keeping everything (its resolvedAt included), moved
 * rows left alone, repeated ids, blank rows left, idempotence and a lost
 * moved-ids write.
 */

import { describe, expect, it } from "vitest";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import {
  TECH_DEBT_CONFLICT_FIELDS,
  TECH_DEBT_KEY,
  TECH_DEBT_MOVED_KEY,
  isPendingTechDebtRow,
  planTechDebtMove,
  readTechDebtRows,
  withPendingTechDebt,
} from "@/lib/tech-debt/legacy";

const rec = (over: Partial<TechDebtItem> = {}): TechDebtItem => ({
  id: "d1",
  title: "Flaky deploy script",
  impact: 3,
  effort: 3,
  raisedAt: "2026-10-01",
  ...over,
});

function runMove(existing: TechDebtItem[], raw: unknown, moved: string[]) {
  const plan = planTechDebtMove(raw, existing, moved);
  const fills = new Map(plan.toFill.map((t) => [t.id, t]));
  return {
    plan,
    items: [...plan.toAdd, ...existing.map((t) => fills.get(t.id) ?? t)],
    moved: plan.moved,
  };
}

describe("the keys", () => {
  it("are the old page's blob and its moved-ids record", () => {
    expect(TECH_DEBT_KEY).toBe("agile-toolkit:tech-debt");
    expect(TECH_DEBT_MOVED_KEY).toBe("agile-toolkit:tech-debt:moved");
    expect(TECH_DEBT_CONFLICT_FIELDS).toEqual([
      "title",
      "description",
      "area",
      "impact",
      "effort",
      "interestRate",
    ]);
  });
});

describe("readTechDebtRows", () => {
  it("reads usable rows once each; anything that isn't a list is none", () => {
    expect(readTechDebtRows("x")).toEqual([]);
    expect(
      readTechDebtRows([rec({ id: "a" }), { title: "no id" }, null, rec({ id: "a", title: "dup" })])
    ).toEqual([rec({ id: "a" })]);
  });
});

describe("planTechDebtMove", () => {
  it("adds blob rows the workspace lacks; the old page's blank 'New Debt' stays behind", () => {
    const blob = [
      rec({ id: "a", interestRate: 1 }),
      { id: "blank", title: "", impact: 3, effort: 3, interestRate: 1, raisedAt: "2026-10-02" },
      { id: "area-only", title: "", area: "ci", impact: 3, effort: 3, raisedAt: "2026-10-02" },
    ];
    const plan = planTechDebtMove(blob, [], []);
    expect(plan.toAdd.map((t) => t.id)).toEqual(["a", "area-only"]);
    expect(plan.moved).toEqual(["a", "blank", "area-only"]);
    expect(plan.changed).toBe(true);
  });

  it("fills only what the workspace row lacks, never a field it holds", () => {
    const ws = rec({ title: "Deploy script (agent's title)", area: " " });
    const blob = [rec({ description: "Fails one run in five", area: "ci", interestRate: 0.5 })];
    expect(planTechDebtMove(blob, [ws], []).toFill).toEqual([
      rec({
        title: "Deploy script (agent's title)",
        description: "Fails one run in five",
        area: "ci",
        interestRate: 0.5,
      }),
    ]);
  });

  it("takes the later status: a resolution the workspace lacks is filled, its own is kept", () => {
    expect(planTechDebtMove([rec({ resolvedAt: "2026-10-20" })], [rec()], []).toFill).toEqual([
      rec({ resolvedAt: "2026-10-20" }),
    ]);
    expect(planTechDebtMove([rec()], [rec({ resolvedAt: "2026-10-22" })], []).toFill).toEqual([]);
    expect(
      planTechDebtMove([rec({ resolvedAt: "2026-10-20" })], [rec({ resolvedAt: "2026-10-22" })], [])
        .toFill
    ).toEqual([]);
  });

  it("reports the values both copies hold differently, kept as the workspace has them", () => {
    const pushed = rec({ description: "Agent's notes", impact: 4, interestRate: 1 });
    const blob = [
      rec({ title: "Flaky deploy script ", description: "Page notes", impact: 4, interestRate: 2 }),
    ];
    expect(planTechDebtMove(blob, [pushed], []).conflicts).toEqual([
      { id: "d1", field: "description", blob: "Page notes", workspace: "Agent's notes" },
      { id: "d1", field: "interestRate", blob: 2, workspace: 1 },
    ]);
    expect(planTechDebtMove(blob, [pushed], ["d1"]).conflicts).toEqual([]);
  });

  it("a row saved since the upgrade keeps everything: a reopen isn't undone, no conflicts", () => {
    // Reopened through a Phase 8 writer before the page's move ran.
    const reopened = rec({ description: "Agent's notes", updatedAt: "2026-10-26T10:00:00Z" });
    const blob = [rec({ description: "Page notes", area: "ci", resolvedAt: "2026-10-20" })];
    const plan = planTechDebtMove(blob, [reopened], []);
    expect(plan.conflicts).toEqual([]);
    // Its gaps still fill; its status (no resolvedAt) stays.
    expect(plan.toFill).toEqual([{ ...reopened, area: "ci" }]);
    expect(withPendingTechDebt([reopened], blob, [])[0].resolvedAt).toBeUndefined();
  });

  it("leaves moved rows alone, an unreadable blob plans nothing, and repeated ids count once", () => {
    expect(planTechDebtMove([rec({ id: "gone" })], [], ["gone"])).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      appeared: [],
      moved: ["gone"],
      changed: false,
    });
    expect(planTechDebtMove(null, [rec()], [])).toMatchObject({ toAdd: [], moved: [] });
    const plan = planTechDebtMove([rec({ id: "a" }), rec({ id: "b" })], [], ["a", "a"]);
    expect(plan.toAdd.map((t) => t.id)).toEqual(["b"]);
    expect(plan.moved).toEqual(["a", "b"]);
  });

  it("names the workspace rows the old page never listed, on the first move only", () => {
    const existing = [rec({ id: "agent" }), rec({ id: "both" })];
    const blob = [rec({ id: "both" })];
    expect(planTechDebtMove(blob, existing, []).appeared).toEqual(["agent"]);
    expect(planTechDebtMove(blob, existing, ["both"]).appeared).toEqual([]);
  });

  it("is idempotent, and a lost moved-ids write plans no writes", () => {
    const blob = [rec({ id: "a", area: "ci" }), rec({ id: "both", resolvedAt: "2026-10-20" })];
    const existing = [rec({ id: "both" })];
    const once = runMove(existing, blob, []);
    expect(once.items.map((t) => [t.id, t.resolvedAt ?? null])).toEqual([
      ["a", null],
      ["both", "2026-10-20"],
    ]);
    expect(planTechDebtMove(blob, once.items, once.moved)).toMatchObject({
      toAdd: [],
      toFill: [],
      conflicts: [],
      changed: false,
    });
    const lost = planTechDebtMove(blob, once.items, []);
    expect([lost.toAdd, lost.toFill]).toEqual([[], []]);
    expect(runMove(once.items, blob, once.moved).items).toEqual(once.items);
  });
});

describe("isPendingTechDebtRow and withPendingTechDebt", () => {
  it("a blob row the move hasn't handled is pending and listed as it will read", () => {
    const blob = [rec({ id: "a" }), rec({ id: "b", area: "ci" })];
    expect(isPendingTechDebtRow("a", blob, [])).toBe(true);
    expect(isPendingTechDebtRow("a", blob, ["a"])).toBe(false);
    expect(isPendingTechDebtRow("z", blob, [])).toBe(false);
    expect(withPendingTechDebt([rec({ id: "b" })], blob, []).map((t) => [t.id, t.area])).toEqual([
      ["b", "ci"],
      ["a", undefined],
    ]);
    expect(withPendingTechDebt([rec({ id: "b" })], blob, ["a", "b"])).toEqual([rec({ id: "b" })]);
  });
});
