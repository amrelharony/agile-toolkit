import { describe, expect, it } from "vitest";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import {
  OLD_BACKLOG_DEFAULTS,
  itemValue,
  oldDefaultMethods,
  readBacklogItem,
  withoutOldDefaults,
} from "@/lib/prioritization/defaults";
import { applyItemPatch } from "@/lib/prioritization/binding";
import { evaluateItem } from "@/lib/prioritization/methods";

/**
 * Old "Add item" defaults: an item the new code never saved whose fields in
 * one method ALL equal the old mid values reads as Not scored in that
 * method; one changed value keeps every value of that method. Pure,
 * idempotent, applied on read; the next save through the new code rewrites
 * the fingerprints to unset and stamps the item.
 */

const legacy = (patch: Partial<BacklogItem> = {}): BacklogItem => ({
  ...OLD_BACKLOG_DEFAULTS,
  id: "b1",
  name: "Search",
  ...patch,
});

describe("old-default fingerprints", () => {
  it("clears every method of an item saved with the exact old defaults", () => {
    const item = legacy();
    expect(oldDefaultMethods(item)).toEqual(["moscow", "wsjf", "rice", "value-effort"]);
    expect(withoutOldDefaults(item)).toEqual({ id: "b1", name: "Search" });
    const s = evaluateItem(item, []);
    for (const id of ["moscow", "wsjf", "rice", "value-effort"] as const) {
      expect(s[id].score, id).toBeNull();
    }
  });

  it("keeps all of a method's values when one of them changed", () => {
    const item = legacy({ timeCriticality: 8, reach: 2500 });
    expect(oldDefaultMethods(item)).toEqual(["moscow", "value-effort"]);
    const read = withoutOldDefaults(item);
    expect(read).toMatchObject({
      businessValue: 5,
      timeCriticality: 8,
      riskReduction: 5,
      jobSize: 5,
      reach: 2500,
      impact: 1,
      confidence: 80,
      effort: 1,
    });
    expect(read.moscow).toBeUndefined();
    expect(read.matrixEffort).toBeUndefined();
    const s = evaluateItem(item, []);
    expect(s.wsjf.score).toBeCloseTo(18 / 5, 6);
    expect(s.rice.score).toBe(2000);
  });

  it("keeps a deliberate Must, or a changed matrix effort", () => {
    expect(oldDefaultMethods(legacy({ moscow: "must" }))).not.toContain("moscow");
    expect(oldDefaultMethods(legacy({ matrixEffort: 3 }))).not.toContain("value-effort");
  });

  it("never touches an item the new code saved (stamped)", () => {
    const stamped = legacy({ updatedAt: "2026-10-26T10:00:00.000Z" });
    expect(oldDefaultMethods(stamped)).toEqual([]);
    expect(withoutOldDefaults(stamped)).toBe(stamped);
    expect(evaluateItem(stamped, []).moscow.bucket).toBe("should");
  });

  it("is pure and idempotent", () => {
    const item = legacy({ businessValue: 13 });
    const once = withoutOldDefaults(item);
    expect(withoutOldDefaults(once)).toEqual(once);
    expect(item.moscow).toBe("should"); // the stored item is untouched
    const nothing = { id: "x", name: "X" };
    expect(withoutOldDefaults(nothing)).toBe(nothing);
  });

  it("rewrites the fingerprints to unset on the next save, so they never come back", () => {
    const saved = applyItemPatch(legacy(), { timeCriticality: 8 }, "2026-10-26T10:00:00.000Z");
    expect(saved).toEqual({
      id: "b1",
      name: "Search",
      timeCriticality: 8,
      updatedAt: "2026-10-26T10:00:00.000Z",
    });
    expect(evaluateItem(saved, []).wsjf.missing).toEqual(["businessValue", "rrOe", "jobSize"]);
  });
});

describe("the one value field", () => {
  it("reads businessValue, else the legacy 1–10 value on the Fibonacci step at or above it", () => {
    expect(itemValue({ businessValue: 13, value: 2 })).toBe(13);
    expect(itemValue({ value: 7 })).toBe(8);
    expect(itemValue({ value: 9 })).toBe(13);
    expect(itemValue({})).toBeUndefined();
  });

  it("reads the legacy value after the WSJF defaults were cleared", () => {
    // Value/Effort linked to a default item wrote value 7 only (the old toBacklog).
    const item = legacy({ value: 7, matrixEffort: 3 });
    expect(readBacklogItem(item).businessValue).toBe(8);
    expect(evaluateItem(item, [])["value-effort"]).toMatchObject({ bucket: "quick_wins" });
  });
});
