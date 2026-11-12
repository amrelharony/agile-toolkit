/**
 * The Product Goal's rules (lib/product-goal/model.ts): one active goal
 * (the latest when a sync left two), the record of earlier ones, the line
 * other pages show, the check list's readings, the form's checks against
 * the agents' caps, the writes that switch goals, and the text link Sprint
 * Goal uses to say which goal it serves.
 */

import { describe, expect, it } from "vitest";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX, type ProductGoal } from "@/lib/stores/workspace-types";
import {
  SERVES_PREFIX,
  activationWrites,
  activeGoal,
  closedGoal,
  daysToTarget,
  extraActiveGoals,
  goalChecks,
  goalDraftFor,
  goalHistory,
  measureLines,
  newGoal,
  objectiveNamesGoal,
  objectiveServingGoal,
  productGoalLine,
  reopenedGoal,
  targetText,
  validateGoalDraft,
  validateNote,
  withGoalValues,
} from "@/lib/product-goal/model";

const goal = (over: Partial<ProductGoal> = {}): ProductGoal => ({
  id: "goal_a",
  statement: "Shop owners take payments anywhere without a card machine",
  measures: ["Weekly active shops"],
  status: "active",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  ...over,
});

describe("the active goal and the record", () => {
  it("finds the active goal, the latest of two, and leaves examples out", () => {
    const a = goal();
    const b = goal({ id: "goal_b", updatedAt: "2026-10-01T10:00:00.000Z" });
    const ex = goal({ id: "example-goal", updatedAt: "2026-12-01T10:00:00.000Z" });
    expect(activeGoal([a, b, ex])?.id).toBe("goal_b");
    expect(activeGoal([a, b, ex], { withExamples: true })?.id).toBe("example-goal");
    expect(extraActiveGoals([a, b]).map((g) => g.id)).toEqual(["goal_a"]);
    expect(activeGoal([goal({ status: "achieved" })])).toBeUndefined();
    expect(activeGoal(undefined)).toBeUndefined();
  });

  it("lists earlier goals newest closed first", () => {
    const list = goalHistory([
      goal({ id: "now" }),
      goal({ id: "old", status: "achieved", closedAt: "2026-03-01T00:00:00.000Z" }),
      goal({ id: "mid", status: "abandoned", closedAt: "2026-06-01T00:00:00.000Z" }),
      // A second active goal left by a sync is not history.
      goal({ id: "also", updatedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(list.map((g) => g.id)).toEqual(["mid", "old"]);
  });

  it("gives other pages one plain line", () => {
    expect(productGoalLine([goal({ statement: "  Pay\n anywhere  " })])).toBe("Pay anywhere");
    expect(productGoalLine([goal({ status: "achieved" })])).toBeNull();
    expect(productGoalLine([goal({ id: "example-1" })])).toBeNull();
  });

  it("reads the target date", () => {
    expect(targetText("2027-06-30")).toBe("by 30 Jun 2027");
    expect(targetText(undefined)).toBe("");
    expect(targetText("soon")).toBe("");
    expect(daysToTarget("2026-11-22", "2026-11-12")).toBe(10);
    expect(daysToTarget("2026-11-02", "2026-11-12")).toBe(-10);
    expect(daysToTarget(undefined, "2026-11-12")).toBeNull();
  });
});

describe("the check list", () => {
  const met = (statement: string, measures: string[] = [], vision = "") =>
    Object.fromEntries(goalChecks({ statement, measures }, vision).map((c) => [c.id, c.met]));

  it("reads an outcome-shaped, measured, single goal as met", () => {
    expect(
      met(
        "Shop owners can take a payment in under 10 seconds",
        [],
        "Shop owners take payments anywhere"
      )
    ).toEqual({ outcome: true, measurable: true, single: true, vision: true });
  });

  it("flags a feature list, no measure, several goals and a goal off the vision", () => {
    expect(
      met(
        "Build the payments app and the reports and the admin site",
        [],
        "Patients book a doctor in a minute"
      )
    ).toEqual({ outcome: false, measurable: false, single: false, vision: false });
  });

  it("leaves the vision to the team when none is written", () => {
    expect(met("Customers can pay by phone", ["Share of phone payments"]).vision).toBeNull();
    const vision = goalChecks({ statement: "x", measures: [] }).find((c) => c.id === "vision");
    expect(vision?.hint).toMatch(/Write the product vision/);
  });
});

describe("the form's checks", () => {
  const draft = { statement: "", why: "", measures: "", targetDate: "" };

  it("needs the statement; the rest is optional", () => {
    const v = validateGoalDraft(draft);
    expect(v.ok || v.errors.statement).toBe("Write the goal: one sentence about the outcome.");
    expect(
      validateGoalDraft({
        statement: "  Pay   anywhere ",
        why: "",
        measures: "- Weekly shops\n\n• Payments a day ",
        targetDate: "2027-06-30",
      })
    ).toEqual({
      ok: true,
      values: {
        statement: "Pay anywhere",
        measures: ["Weekly shops", "Payments a day"],
        targetDate: "2027-06-30",
      },
    });
  });

  it("holds the agents' caps", () => {
    const long = validateGoalDraft({ ...draft, statement: "x".repeat(TOOL_TEXT_MAX.text + 1) });
    expect(long.ok || long.errors.statement).toMatch(/1,000 characters or fewer/);
    const many = validateGoalDraft({
      ...draft,
      statement: "Pay",
      measures: Array.from({ length: TOOL_LIST_MAX.measures + 1 }, (_, i) => `m${i}`).join("\n"),
    });
    expect(many.ok || many.errors.measures).toBe("Keep it to 10 measures or fewer.");
    const longMeasure = validateGoalDraft({
      ...draft,
      statement: "Pay",
      measures: "y".repeat(TOOL_TEXT_MAX.short + 1),
    });
    expect(longMeasure.ok || longMeasure.errors.measures).toMatch(/200 characters/);
    const day = validateGoalDraft({ ...draft, statement: "Pay", targetDate: "2027-02-30" });
    expect(day.ok || day.errors.targetDate).toBe("Pick a day, or leave it empty.");
    expect(validateNote("x".repeat(TOOL_TEXT_MAX.text + 1)).ok).toBe(false);
    expect(validateNote("  ")).toEqual({ ok: true, values: undefined });
  });

  it("round-trips a goal through the form", () => {
    const g = goal({ why: "Card machines cost too much", targetDate: "2027-06-30" });
    const d = goalDraftFor(g);
    expect(d.measures).toBe("Weekly active shops");
    const v = validateGoalDraft(d);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const next = withGoalValues(g, { ...v.values, why: undefined }, "2026-11-12T00:00:00.000Z");
      expect(next).not.toHaveProperty("why");
      expect(next.updatedAt).toBe("2026-11-12T00:00:00.000Z");
    }
    expect(measureLines(" a \n\n - b")).toEqual(["a", "b"]);
  });
});

describe("switching goals", () => {
  const NOW = "2026-11-12T09:00:00.000Z";

  it("closes every other active goal first, then makes the new one active", () => {
    const writes = activationWrites(
      [goal(), goal({ id: "goal_b" }), goal({ id: "goal_c", status: "achieved" })],
      newGoal("goal_new", { statement: "Next", measures: [] }, NOW),
      "achieved",
      NOW,
      "Reached in October"
    );
    expect(writes.map((g) => [g.id, g.status])).toEqual([
      ["goal_a", "achieved"],
      ["goal_b", "achieved"],
      ["goal_new", "active"],
    ]);
    expect(writes[0]).toMatchObject({ closedAt: NOW, note: "Reached in October" });
  });

  it("closes and reopens one goal", () => {
    const closed = closedGoal(goal({ note: "old" }), "abandoned", NOW);
    expect(closed).toMatchObject({ status: "abandoned", closedAt: NOW });
    expect(closed).not.toHaveProperty("note");
    const open = reopenedGoal(closed, NOW);
    expect(open.status).toBe("active");
    expect(open).not.toHaveProperty("closedAt");
  });
});

describe("Sprint Goal's text link to the Product Goal", () => {
  const g = goal({ statement: "Pay anywhere" });

  it("puts the goal first and keeps what was typed under it", () => {
    expect(objectiveServingGoal("", g)).toBe(
      `${SERVES_PREFIX}: “Pay anywhere”. This sprint moves it by: `
    );
    expect(objectiveServingGoal("Faster refunds", g)).toBe(
      `${SERVES_PREFIX}: “Pay anywhere”. This sprint moves it by: \nFaster refunds`
    );
  });

  it("leaves an objective that already names it alone", () => {
    const named = objectiveServingGoal("", g);
    expect(objectiveNamesGoal(named, g)).toBe(true);
    expect(objectiveServingGoal(named, g)).toBe(named);
    expect(objectiveNamesGoal("We move pay anywhere forward", g)).toBe(true);
    expect(objectiveNamesGoal("Faster refunds", g)).toBe(false);
  });
});
