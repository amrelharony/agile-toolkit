// @vitest-environment node
/**
 * lib/flow/work-types: the kinds of work and the team's target mix.
 *
 *   - a label and a meaning for every kind, in our words;
 *   - a typed split: four whole numbers 0–100 adding up to 100, or all
 *     blank for none, with a message for each field and for the sum;
 *   - the read rule: a split counts only when all four are set and add up
 *     to 100;
 *   - writing it on the workflow definition: meanings kept, created when
 *     there is none, null clears, the same definition when unchanged.
 */

import { describe, expect, it } from "vitest";
import {
  WORK_TYPE_LABEL,
  WORK_TYPE_MEANING,
  isTargetSplit,
  targetSplitOf,
  validateTargetSplit,
  withTargetSplit,
  type TargetSplit,
} from "@/lib/flow/work-types";
import {
  WORKFLOW_DEFINITION_ID,
  WORK_TYPES,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";

const AT = "2026-11-23T10:00:00.000Z";
const LATER = "2026-11-24T10:00:00.000Z";
const SPLIT: TargetSplit = { feature: 60, defect: 15, debt: 15, risk: 10 };

const def = (patch: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: WORKFLOW_DEFINITION_ID,
  createdAt: AT,
  updatedAt: AT,
  ...patch,
});

const withTargets = (split: Partial<Record<string, number>>, meanings = true) =>
  def({
    workTypes: WORK_TYPES.map((type) => ({
      type,
      ...(meanings ? { meaning: `Our ${type}` } : {}),
      ...(split[type] !== undefined ? { targetPct: split[type] } : {}),
    })),
  });

describe("labels and meanings", () => {
  it("names and explains every kind of work", () => {
    for (const type of WORK_TYPES) {
      expect(WORK_TYPE_LABEL[type]).toMatch(/^[A-Z][a-z]+$/);
      expect(WORK_TYPE_MEANING[type]).toMatch(/^[A-Z].+\.$/);
    }
    expect(WORK_TYPE_MEANING.defect).toBe("Fixing something that doesn't work as it should.");
  });
});

describe("validateTargetSplit", () => {
  it("reads four blanks as no target", () => {
    expect(validateTargetSplit({})).toEqual({ ok: true, values: null });
    expect(validateTargetSplit({ feature: "", defect: "  ", debt: null, risk: undefined })).toEqual(
      { ok: true, values: null }
    );
  });

  it("takes four whole numbers that add up to 100, typed or as numbers", () => {
    expect(validateTargetSplit({ feature: "60", defect: " 15 ", debt: 15, risk: "10" })).toEqual({
      ok: true,
      values: SPLIT,
    });
    expect(validateTargetSplit({ feature: 100, defect: 0, debt: 0, risk: 0 })).toEqual({
      ok: true,
      values: { feature: 100, defect: 0, debt: 0, risk: 0 },
    });
  });

  it("names each field that isn't a whole number from 0 to 100", () => {
    const out = validateTargetSplit({ feature: "60.5", defect: "-5", debt: "abc", risk: 101 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(Object.keys(out.errors).sort()).toEqual(["debt", "defect", "feature", "risk"]);
    expect(out.errors.feature).toBe("Enter a whole number from 0 to 100.");
  });

  it("asks for every share once one is set", () => {
    const out = validateTargetSplit({ feature: "70", defect: "30" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors).toEqual({
      debt: "Enter a share for Debt, or clear all four.",
      risk: "Enter a share for Risk, or clear all four.",
    });
  });

  it("says what the four add up to when it isn't 100", () => {
    const out = validateTargetSplit({ feature: 50, defect: 20, debt: 10, risk: 10 });
    expect(out).toEqual({
      ok: false,
      errors: { total: "The four add up to 90. Make them add up to 100." },
    });
    // Field errors come first: no sum is checked until each field is good.
    const both = validateTargetSplit({ feature: 50, defect: "x", debt: 10, risk: 10 });
    expect(both.ok === false && "total" in both.errors).toBe(false);
  });
});

describe("isTargetSplit and targetSplitOf", () => {
  it("knows a target mix", () => {
    expect(isTargetSplit(SPLIT)).toBe(true);
    expect(isTargetSplit({ ...SPLIT, risk: 9 })).toBe(false);
    expect(isTargetSplit({ ...SPLIT, feature: 59.5, risk: 10.5 })).toBe(false);
    expect(isTargetSplit({ feature: 100 })).toBe(false);
    expect(isTargetSplit(null)).toBe(false);
  });

  it("reads a split only when all four are set and add up to 100", () => {
    expect(targetSplitOf(undefined)).toBeNull();
    expect(targetSplitOf(def())).toBeNull();
    expect(targetSplitOf(withTargets(SPLIT))).toEqual(SPLIT);
    expect(targetSplitOf(withTargets({ feature: 60, defect: 20, debt: 20 }))).toBeNull();
    expect(targetSplitOf(withTargets({ ...SPLIT, risk: 5 }))).toBeNull();
    expect(targetSplitOf(withTargets({ ...SPLIT, feature: -10, risk: 80 }))).toBeNull();
  });

  it("reads a hand-edited list as far as it can", () => {
    const messy = def({
      workTypes: [
        null,
        { type: "chore", targetPct: 50 },
        { type: "feature", targetPct: 60 },
        { type: "feature", targetPct: 10 },
        { type: "defect", targetPct: 15 },
        { type: "debt", targetPct: 15 },
        { type: "risk", targetPct: 10 },
      ] as unknown as WorkflowDefinition["workTypes"],
    });
    expect(targetSplitOf(messy)).toEqual(SPLIT);
    expect(targetSplitOf(def({ workTypes: "x" as unknown as [] }))).toBeNull();
  });
});

describe("withTargetSplit", () => {
  it("creates the definition when there is none", () => {
    expect(withTargetSplit(undefined, SPLIT, AT)).toEqual({
      id: WORKFLOW_DEFINITION_ID,
      createdAt: AT,
      updatedAt: AT,
      workTypes: [
        { type: "feature", targetPct: 60 },
        { type: "defect", targetPct: 15 },
        { type: "debt", targetPct: 15 },
        { type: "risk", targetPct: 10 },
      ],
    });
  });

  it("sets each target, keeping the meanings and every other field", () => {
    const current = def({
      board: "flow",
      wipPolicy: "Finish before starting",
      workTypes: [
        { type: "risk", meaning: "Audits" },
        { type: "feature", meaning: "New things" },
      ],
    });
    const out = withTargetSplit(current, SPLIT, LATER);
    expect(out).toEqual({
      ...current,
      updatedAt: LATER,
      workTypes: [
        { type: "feature", meaning: "New things", targetPct: 60 },
        { type: "defect", targetPct: 15 },
        { type: "debt", targetPct: 15 },
        { type: "risk", meaning: "Audits", targetPct: 10 },
      ],
    });
    expect(targetSplitOf(out)).toEqual(SPLIT);
    expect(current.workTypes).toHaveLength(2);
  });

  it("clears every target with null, keeping the meanings", () => {
    const out = withTargetSplit(withTargets(SPLIT), null, LATER);
    expect(out.updatedAt).toBe(LATER);
    expect(out.workTypes).toEqual(WORK_TYPES.map((type) => ({ type, meaning: `Our ${type}` })));
    expect(targetSplitOf(out)).toBeNull();
    // With no meanings left, the list goes.
    const bare = withTargetSplit(withTargets(SPLIT, false), null, LATER);
    expect("workTypes" in bare).toBe(false);
    // A half-set list is cleared too.
    const half = withTargetSplit(withTargets({ feature: 50 }, false), null, LATER);
    expect("workTypes" in half).toBe(false);
  });

  it("gives the same definition back when its targets are already the split", () => {
    const current = withTargets(SPLIT);
    expect(withTargetSplit(current, { ...SPLIT }, LATER)).toBe(current);
    const none = def({ workTypes: [{ type: "debt", meaning: "Cleanup" }] });
    expect(withTargetSplit(none, null, LATER)).toBe(none);
  });

  it("stamps the current time by default", () => {
    const out = withTargetSplit(undefined, SPLIT);
    expect(Date.parse(out.updatedAt!)).toBeGreaterThan(Date.parse("2026-01-01"));
  });
});
