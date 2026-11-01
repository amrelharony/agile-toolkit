/**
 * What the Test Pyramid page shows, worked out from lib/quality/pyramid:
 * the shape over the snapshots (summary and table for its chart), a
 * snapshot set beside today's counts, and run-cost wording. Pure, so the
 * page, the Markdown export and the tests read the same text.
 */

import { NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import {
  PYRAMID_SHAPE_LABEL,
  TEST_LAYERS,
  TEST_LAYER_LABEL,
  classifyShape,
  hasAllRuntimes,
  layerShares,
  sharePercents,
  shapeHistory,
  type LayerValues,
  type RunCost,
  type TestLayer,
} from "@/lib/quality/pyramid";
import type {
  TestPyramid,
  TestPyramidSnapshot,
  TestPyramidWeighting,
} from "@/lib/stores/workspace-types";

/** "1,240". */
export const count = (n: number) => n.toLocaleString("en-US");

/** "4.5 min". */
export const minutes = (n: number) => `${Math.round(n * 10) / 10} min`;

/** "12 Mar 2026" for a stored "YYYY-MM-DD". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The run-cost card's value and note, for the weighting in use. */
export function runCostText(cost: RunCost | null): { value: string; hint: string } {
  if (!cost) return { value: "—", hint: "Needs the minutes of all three layers" };
  return cost.basis === "runtime"
    ? { value: minutes(cost.total), hint: "Minutes of CI time for one full run" }
    : {
        value: count(cost.total),
        hint: "Index: each unit test 1, integration 5, e2e 25",
      };
}

/** One point per snapshot: whole-percent shares (null when it has none by this weighting). */
export interface ShapePoint {
  id: string;
  takenOn: string;
  shape: string;
  percents: LayerValues | null;
}

export function shapePoints(
  snapshots: readonly TestPyramidSnapshot[],
  weighting: TestPyramidWeighting
): ShapePoint[] {
  return shapeHistory(snapshots, weighting).map((p) => ({
    id: p.id,
    takenOn: p.takenOn,
    shape: p.shape ? PYRAMID_SHAPE_LABEL[p.shape] : "No run times",
    percents: p.shares ? sharePercents(p.shares) : null,
  }));
}

/** The shape over time: the first and last snapshot's shape and unit share, and a row per snapshot. */
export function shapeChartText(points: readonly ShapePoint[]): ChartText {
  const shaped = points.filter((p) => p.percents !== null);
  const first = shaped[0];
  const last = shaped[shaped.length - 1];
  let summary = "No snapshot has a shape yet.";
  if (first && last && first !== last) {
    const a = (first.percents as LayerValues).unit;
    const b = (last.percents as LayerValues).unit;
    const shapes =
      first.shape === last.shape
        ? `stayed ${last.shape.toLowerCase()}`
        : `went from ${first.shape.toLowerCase()} to ${last.shape.toLowerCase()}`;
    summary = `From ${dayLabel(first.takenOn)} to ${dayLabel(last.takenOn)} the suite ${shapes}; unit tests ${
      a === b ? `stayed at ${b}%` : `${b > a ? "rose" : "fell"} from ${a}% to ${b}%`
    }.`;
  } else if (last) {
    // The chart draws every snapshot, so say when the others have no shares
    // (no run times by run time, or nothing counted) rather than "one so far".
    const shape = `${last.shape.toLowerCase()} on ${dayLabel(last.takenOn)}`;
    summary =
      points.length > 1
        ? `Only 1 of ${points.length} snapshots has layer shares: ${shape}.`
        : `One snapshot so far: ${shape}.`;
  }
  return {
    summary,
    table: {
      columns: ["Day", "Shape", "Unit", "Integration", "E2E"],
      rows: points.map((p) => [
        p.takenOn,
        p.shape,
        ...TEST_LAYERS.map((l) => (p.percents ? `${p.percents[l]}%` : NO_VALUE)),
      ]),
    },
  };
}

export interface CompareRow {
  layer: TestLayer;
  label: string;
  then: number;
  now: number;
  /** now − then, in tests. */
  change: number;
  /** Whole-percent share by the weighting compared on; null when that side has none. */
  thenPct: number | null;
  nowPct: number | null;
}

/** A share in the comparison, "42%", or "—" (never "—%") when there is none. */
export const shareText = (pct: number | null) => (pct === null ? NO_VALUE : `${pct}%`);

type Counted = Pick<TestPyramid, "unit" | "integration" | "e2e" | "runtime">;

/** Shares and shape name of counts weighed as `weighting`, as shapeHistory reads a snapshot. */
function weighed(v: Counted, weighting: TestPyramidWeighting) {
  // By run time, layers without all three minutes have no shape: never one by count instead.
  if (weighting === "runtime" && !hasAllRuntimes(v.runtime)) {
    return { percents: null, shape: "No run times" };
  }
  const shares = layerShares(v, weighting, v.runtime);
  return {
    percents: shares ? sharePercents(shares) : null,
    shape: PYRAMID_SHAPE_LABEL[classifyShape(shares)],
  };
}

/**
 * A snapshot's counts beside today's, layer by layer, with the shares and
 * shapes on the page's weighting (by test count unless given), so the
 * comparison names the same shape as the Shape card above it and the
 * snapshot table. By run time a snapshot without all three minutes reads
 * "No run times", as it does on the chart; the counts and their change
 * show either way. `basis` names the weighting for the caption.
 */
export function compareWithNow(
  snapshot: TestPyramidSnapshot,
  doc: Counted,
  weighting: TestPyramidWeighting = "count"
): { rows: CompareRow[]; thenShape: string; nowShape: string; basis: string } {
  const then = weighed(snapshot, weighting);
  const now = weighed(doc, weighting);
  return {
    rows: TEST_LAYERS.map((l) => ({
      layer: l,
      label: TEST_LAYER_LABEL[l],
      then: snapshot[l],
      now: doc[l],
      change: doc[l] - snapshot[l],
      thenPct: then.percents ? then.percents[l] : null,
      nowPct: now.percents ? now.percents[l] : null,
    })),
    thenShape: then.shape,
    nowShape: now.shape,
    basis: weighting === "runtime" ? "by run time" : "by test count",
  };
}

/** "+120", "−8", "0". */
export const signed = (n: number) => (n > 0 ? `+${count(n)}` : n < 0 ? `−${count(-n)}` : "0");
