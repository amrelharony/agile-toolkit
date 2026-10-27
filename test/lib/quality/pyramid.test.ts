/**
 * lib/quality/pyramid: the Test Pyramid's shape, run cost and snapshots,
 * shared by the page and tool.test_pyramid.*.
 *
 *   1. layerShares — by count, by runtime (needs all three), empty.
 *   2. classifyShape — each shape, ties inside the tolerance, the boundary.
 *   3. sharePercents + shapeVerdict — whole percents adding to 100; an
 *      even split's reading true of the percents beside it.
 *   4. runCost — the 1 / 5 / 25 index, or minutes.
 *   5. snapshots — day rule, order, removal, shape history; legacy docs.
 *   6. draft errors — counts and runtimes.
 */

import { describe, expect, it } from "vitest";
import {
  PYRAMID_SHAPE_LABEL,
  SHAPE_TOLERANCE,
  classifyShape,
  countsErrors,
  hasAllRuntimes,
  layerShares,
  newSnapshotId,
  relativeCost,
  runCost,
  runtimeErrors,
  shapeHistory,
  shapeVerdict,
  sharePercents,
  snapshotDayError,
  snapshotOf,
  snapshotsOf,
  weightingOf,
  withSnapshot,
  withoutSnapshot,
  type LayerShares,
} from "@/lib/quality/pyramid";
import type { TestPyramid } from "@/lib/stores/workspace-types";
import { LEGACY_TEST_PYRAMID, TEST_PYRAMID } from "../../stores/phase8-fixtures";

const shape = (unit: number, integration: number, e2e: number) =>
  classifyShape(layerShares({ unit, integration, e2e }));

describe("layerShares", () => {
  it("shares out the counts", () => {
    expect(layerShares({ unit: 70, integration: 20, e2e: 10 })).toEqual({
      unit: 0.7,
      integration: 0.2,
      e2e: 0.1,
    });
  });

  it("is null with nothing counted or a layer that isn't a count", () => {
    expect(layerShares({ unit: 0, integration: 0, e2e: 0 })).toBeNull();
    expect(layerShares({ unit: 5, integration: 1 })).toBeNull();
    expect(layerShares({ unit: 5, integration: -1, e2e: 2 })).toBeNull();
  });

  it("shares out the minutes by runtime, and needs all three", () => {
    const r = layerShares(TEST_PYRAMID, "runtime", TEST_PYRAMID.runtime);
    expect(r?.e2e).toBeCloseTo(26.5 / 41.5, 10);
    expect(layerShares(TEST_PYRAMID, "runtime", { unit: 4, integration: 11 })).toBeNull();
    expect(layerShares(TEST_PYRAMID, "runtime", undefined)).toBeNull();
    expect(hasAllRuntimes({ unit: 0, integration: 0, e2e: 0 })).toBe(true);
    expect(hasAllRuntimes({ unit: 1, integration: 2 })).toBe(false);
  });

  it("reads a document's weighting, absent as count", () => {
    expect(weightingOf(LEGACY_TEST_PYRAMID)).toBe("count");
    expect(weightingOf(TEST_PYRAMID)).toBe("runtime");
    expect(weightingOf(null)).toBe("count");
  });
});

describe("classifyShape", () => {
  it("names each shape from all three layers", () => {
    expect(shape(70, 20, 10)).toBe("pyramid");
    expect(shape(10, 20, 70)).toBe("ice-cream-cone");
    // Unit > e2e, but the thin middle makes it an hourglass, which the
    // old e2e > unit check never flagged.
    expect(shape(100, 10, 80)).toBe("hourglass");
    expect(shape(20, 60, 20)).toBe("diamond");
    expect(shape(34, 33, 33)).toBe("even");
    expect(classifyShape(null)).toBe("empty");
  });

  it("reads top-heavy as a cone even when unit isn't the smallest", () => {
    // Integration and e2e level, both well above unit.
    expect(shape(20, 40, 40)).toBe("ice-cream-cone");
    // Unit and integration level, both well above e2e.
    expect(shape(40, 40, 20)).toBe("pyramid");
  });

  it("treats layers within the tolerance as level", () => {
    expect(SHAPE_TOLERANCE).toBe(0.05);
    // Exactly 5 points apart is level: no shape on one test's difference.
    const exact: LayerShares = { unit: 0.36, integration: 0.33, e2e: 0.31 };
    expect(classifyShape(exact)).toBe("even");
    const over: LayerShares = { unit: 0.37, integration: 0.33, e2e: 0.3 };
    expect(classifyShape(over)).toBe("pyramid");
    // A wider tolerance levels more.
    expect(classifyShape({ unit: 0.5, integration: 0.3, e2e: 0.2 }, 0.35)).toBe("even");
  });

  it("names the legacy fixture's hourglass and the runtime cone", () => {
    expect(classifyShape(layerShares(LEGACY_TEST_PYRAMID))).toBe("hourglass");
    expect(classifyShape(layerShares(TEST_PYRAMID))).toBe("pyramid");
    expect(classifyShape(layerShares(TEST_PYRAMID, "runtime", TEST_PYRAMID.runtime))).toBe(
      "ice-cream-cone"
    );
  });
});

describe("sharePercents and shapeVerdict", () => {
  it("rounds to whole percents that add up to 100", () => {
    expect(sharePercents({ unit: 1 / 3, integration: 1 / 3, e2e: 1 / 3 })).toEqual({
      unit: 34,
      integration: 33,
      e2e: 33,
    });
    const p = sharePercents(layerShares({ unit: 48, integration: 6, e2e: 46 }) as LayerShares);
    expect(p).toEqual({ unit: 48, integration: 6, e2e: 46 });
  });

  it("says the shape, the split and what it means", () => {
    const shares = layerShares({ unit: 48, integration: 6, e2e: 46 });
    expect(shapeVerdict(classifyShape(shares), shares)).toBe(
      "Hourglass: 48% unit, 6% integration, 46% e2e. The middle layer is thin."
    );
    const byTime = layerShares(TEST_PYRAMID, "runtime", TEST_PYRAMID.runtime);
    expect(shapeVerdict(classifyShape(byTime), byTime, "runtime")).toMatch(
      /^Ice-cream cone by run time: 10% unit, 26% integration, 64% e2e\./
    );
  });

  it("reads an even split truly, level or a little over the tolerance", () => {
    const level = layerShares({ unit: 34, integration: 33, e2e: 33 });
    expect(shapeVerdict(classifyShape(level), level)).toBe(
      "Even: 34% unit, 33% integration, 33% e2e. No layer stands out by more than 5 points."
    );
    // Integration 7 points over unit but within 5 of e2e: no named shape,
    // and the sentence says how far apart the layers are instead.
    for (const [u, i, e, gap] of [
      [30, 37, 33, 7],
      [37, 30, 33, 7],
      [29, 38, 33, 9],
    ]) {
      const shares = layerShares({ unit: u, integration: i, e2e: e });
      expect(classifyShape(shares)).toBe("even");
      expect(shapeVerdict("even", shares)).toBe(
        `Even: ${u}% unit, ${i}% integration, ${e}% e2e. No clear shape: the layers are within ${gap} points of each other.`
      );
    }
  });

  it("has a sentence for nothing counted, by count and by runtime", () => {
    expect(shapeVerdict("empty", null)).toBe("No tests counted yet.");
    expect(shapeVerdict("empty", null, "runtime")).toMatch(/minutes each layer/);
    expect(PYRAMID_SHAPE_LABEL.diamond).toBe("Diamond (testing trophy)");
  });
});

describe("runCost", () => {
  it("is the relative 1 / 5 / 25 index by count", () => {
    expect(relativeCost({ unit: 100, integration: 10, e2e: 2 })).toBe(200);
    expect(runCost({ unit: 100, integration: 10, e2e: 2 })).toEqual({
      basis: "count",
      byLayer: { unit: 100, integration: 50, e2e: 50 },
      total: 200,
    });
  });

  it("is the entered minutes by runtime, or null without all three", () => {
    expect(runCost(TEST_PYRAMID, "runtime", TEST_PYRAMID.runtime)).toEqual({
      basis: "runtime",
      byLayer: { unit: 4, integration: 11, e2e: 26.5 },
      total: 41.5,
    });
    expect(runCost(TEST_PYRAMID, "runtime", { unit: 4 })).toBeNull();
  });
});

describe("snapshots", () => {
  const today = "2026-10-27";

  it("accepts a backdated day and refuses a future or unreadable one", () => {
    expect(snapshotDayError("2025-01-15", today)).toBeNull();
    expect(snapshotDayError(today, today)).toBeNull();
    expect(snapshotDayError("2026-10-28", today)).toBe("The day can't be after today.");
    expect(snapshotDayError("2026-02-30", today)).toBe("Enter a date as YYYY-MM-DD.");
    expect(snapshotDayError("27/10/2026", today)).toBe("Enter a date as YYYY-MM-DD.");
    expect(snapshotDayError("  ", today)).toBe("Enter the day the counts are for.");
  });

  it("copies the counts, the entered minutes and a trimmed note", () => {
    const s = snapshotOf(TEST_PYRAMID, "2026-10-20", "tps_x", "  after the split ");
    expect(s).toEqual({
      id: "tps_x",
      takenOn: "2026-10-20",
      unit: 820,
      integration: 140,
      e2e: 35,
      runtime: { unit: 4, integration: 11, e2e: 26.5 },
      note: "after the split",
    });
    expect(snapshotOf(LEGACY_TEST_PYRAMID, today, "tps_y")).toEqual({
      id: "tps_y",
      takenOn: today,
      unit: 120,
      integration: 40,
      e2e: 60,
    });
  });

  it("keeps snapshots in day order, a backdated one before later ones", () => {
    const doc = withSnapshot(TEST_PYRAMID, snapshotOf(TEST_PYRAMID, "2026-08-15", "tps_mid"));
    expect(snapshotsOf(doc).map((s) => s.id)).toEqual(["tps_aaaa1111", "tps_mid", "tps_bbbb2222"]);
    // A second one on the same day goes after the first.
    const same = withSnapshot(doc, snapshotOf(doc, "2026-08-15", "tps_mid2"));
    expect(snapshotsOf(same).map((s) => s.id)).toEqual([
      "tps_aaaa1111",
      "tps_mid",
      "tps_mid2",
      "tps_bbbb2222",
    ]);
  });

  it("removes one by id, and says when there is none", () => {
    const next = withoutSnapshot(TEST_PYRAMID, "tps_aaaa1111") as TestPyramid;
    expect(next.snapshots?.map((s) => s.id)).toEqual(["tps_bbbb2222"]);
    expect(withoutSnapshot(TEST_PYRAMID, "nope")).toBeNull();
    expect(withoutSnapshot(LEGACY_TEST_PYRAMID, "tps_aaaa1111")).toBeNull();
    expect(snapshotsOf(LEGACY_TEST_PYRAMID)).toEqual([]);
  });

  it("follows the shape over time, one basis for the whole series", () => {
    const byCount = shapeHistory(TEST_PYRAMID.snapshots ?? []);
    expect(byCount.map((p) => p.shape)).toEqual(["hourglass", "pyramid"]);
    expect(byCount[0].unitShare).toBeCloseTo(300 / 510, 10);
    // The July snapshot has no minutes: no shape by runtime, never one by count.
    const byTime = shapeHistory(TEST_PYRAMID.snapshots ?? [], "runtime");
    expect(byTime.map((p) => p.shape)).toEqual([null, "ice-cream-cone"]);
    expect(byTime[0].unitShare).toBeNull();
  });

  it("mints snapshot ids", () => {
    expect(newSnapshotId()).toMatch(/^tps_[\w-]{8}$/);
  });
});

describe("draft errors", () => {
  it("needs every count as a whole number of 0 or more", () => {
    expect(countsErrors({ unit: "120", integration: "0", e2e: 4 })).toEqual({});
    expect(countsErrors({ unit: "", integration: "1.5", e2e: "-2" })).toEqual({
      unit: "Enter the number of unit tests.",
      integration: "Enter a whole number of 0 or more.",
      e2e: "Enter a whole number of 0 or more.",
    });
    expect(countsErrors({}).e2e).toBe("Enter the number of end-to-end tests.");
  });

  it("lets runtimes be blank but not negative", () => {
    expect(runtimeErrors({ unit: "", integration: "2.5" })).toEqual({});
    expect(runtimeErrors({ e2e: "-1", unit: "x" })).toEqual({
      e2e: "Enter minutes of 0 or more.",
      unit: "Enter minutes of 0 or more.",
    });
  });
});
