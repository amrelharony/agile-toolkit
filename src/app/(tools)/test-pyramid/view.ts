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
    summary = `One snapshot so far: ${last.shape.toLowerCase()} on ${dayLabel(last.takenOn)}.`;
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
  thenPct: number | null;
  nowPct: number | null;
}

/** A snapshot's counts beside today's, layer by layer, with the shares by count. */
export function compareWithNow(
  snapshot: TestPyramidSnapshot,
  doc: Pick<TestPyramid, "unit" | "integration" | "e2e">
): { rows: CompareRow[]; thenShape: string; nowShape: string } {
  const thenShares = layerShares(snapshot);
  const nowShares = layerShares(doc);
  const thenPct = thenShares ? sharePercents(thenShares) : null;
  const nowPct = nowShares ? sharePercents(nowShares) : null;
  return {
    rows: TEST_LAYERS.map((l) => ({
      layer: l,
      label: TEST_LAYER_LABEL[l],
      then: snapshot[l],
      now: doc[l],
      change: doc[l] - snapshot[l],
      thenPct: thenPct ? thenPct[l] : null,
      nowPct: nowPct ? nowPct[l] : null,
    })),
    thenShape: PYRAMID_SHAPE_LABEL[classifyShape(thenShares)],
    nowShape: PYRAMID_SHAPE_LABEL[classifyShape(nowShares)],
  };
}

/** "+120", "−8", "0". */
export const signed = (n: number) => (n > 0 ? `+${count(n)}` : n < 0 ? `−${count(-n)}` : "0");
