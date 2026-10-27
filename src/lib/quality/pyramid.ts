/**
 * The Test Pyramid: the unit / integration / e2e split of a suite, the
 * shape that split makes, what the suite costs to run, and dated snapshots
 * of the counts. One workspace document (TEST_PYRAMID_ID) that the page and
 * tool.test_pyramid.* read through these functions, so a person and an
 * agent name the same shape.
 *
 * Pure and server-safe: no React, nothing from components (the agent's
 * server bundle imports it).
 *
 *   - The shape comes from all three layers' shares, compared with a
 *     tolerance (SHAPE_TOLERANCE, 5 points): layers within it count as
 *     level, so 34 / 33 / 33 is "even" rather than flipping between shapes
 *     on one test.
 *   - Shares are of the test counts, or of the minutes each layer's suite
 *     takes when the document weighs by runtime (which needs all three).
 *   - The old fixed weights (1 / 5 / 25 per test) give a relative run cost,
 *     a unitless index, not money; with runtimes, the minutes are the cost.
 */

import { nanoid } from "nanoid";
import type {
  TestLayerRuntime,
  TestPyramid,
  TestPyramidSnapshot,
  TestPyramidWeighting,
} from "@/lib/stores/workspace-types";
import { isIsoDate } from "@/lib/sprints/calendar";
import { parseNumber, type FormErrors } from "@/lib/utils/form";

/** The singleton document's id (the page and the agent's writes share it). */
export const TEST_PYRAMID_ID = "testPyramid:current";
/** Its entity kind on the server (registerCollection("testPyramid", …)). */
export const TEST_PYRAMID_KIND = "workspace:testPyramid";

export type TestLayer = "unit" | "integration" | "e2e";

export const TEST_LAYERS: readonly TestLayer[] = ["unit", "integration", "e2e"];

export const TEST_LAYER_LABEL: Record<TestLayer, string> = {
  unit: "Unit",
  integration: "Integration",
  e2e: "End-to-end",
};

export type PyramidShape =
  | "pyramid"
  | "ice-cream-cone"
  | "hourglass"
  | "diamond"
  | "even"
  | "empty";

export const PYRAMID_SHAPE_LABEL: Record<PyramidShape, string> = {
  pyramid: "Pyramid",
  "ice-cream-cone": "Ice-cream cone",
  hourglass: "Hourglass",
  diamond: "Diamond (testing trophy)",
  even: "Even",
  empty: "Not counted yet",
};

/** Two layers' shares must differ by more than this (5 points) for one to be wider. */
export const SHAPE_TOLERANCE = 0.05;

/** The relative cost of running one test of each layer: the old page's fixed weights. */
export const RUN_COST_WEIGHTS: Record<TestLayer, number> = { unit: 1, integration: 5, e2e: 25 };

/** At most this many snapshots are kept on the document (50 years of quarterly ones). */
export const PYRAMID_SNAPSHOT_MAX = 200;
/** A snapshot's note (the CRUD schema's bound). */
export const PYRAMID_NOTE_MAX = 500;

/** One number per layer: counts, minutes, or 0..1 shares. */
export type LayerValues = Record<TestLayer, number>;

/** Each layer's part of the whole, 0..1, adding up to 1. */
export type LayerShares = LayerValues;

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Whether all three layers have a runtime of 0 minutes or more: what weighing by runtime needs. */
export function hasAllRuntimes(
  runtime: TestLayerRuntime | null | undefined
): runtime is Required<TestLayerRuntime> {
  return Boolean(runtime) && TEST_LAYERS.every((l) => isCount(runtime?.[l]));
}

/** The document's weighting as stored; absent reads as "count". */
export function weightingOf(doc: Pick<TestPyramid, "weighting"> | null | undefined) {
  return doc?.weighting === "runtime" ? ("runtime" as const) : ("count" as const);
}

/**
 * Each layer's share of the counts, or of the runtimes with "runtime"
 * weighting. Null when there is nothing to share out (all 0), a value
 * isn't a number of 0 or more, or runtime weighting lacks a layer's minutes.
 */
export function layerShares(
  counts: Partial<LayerValues>,
  weighting: TestPyramidWeighting = "count",
  runtime?: TestLayerRuntime | null
): LayerShares | null {
  const source: Partial<LayerValues> | null | undefined =
    weighting === "runtime" ? runtime : counts;
  if (!source || !TEST_LAYERS.every((l) => isCount(source[l]))) return null;
  const values = source as LayerValues;
  const total = values.unit + values.integration + values.e2e;
  if (total <= 0) return null;
  return {
    unit: values.unit / total,
    integration: values.integration / total,
    e2e: values.e2e / total,
  };
}

/**
 * The shape the shares make. `a` is wider than `b` when its share is more
 * than `tol` above (a hair of float slack, so exactly 5 points is level):
 *
 *   pyramid         unit wider than e2e; no layer wider than the one below it
 *   ice-cream cone  e2e wider than unit; no layer wider than the one above it
 *   hourglass       unit and e2e both wider than integration
 *   diamond         integration wider than both (the testing trophy)
 *   even            anything else: no layer stands out
 *   empty           no shares (nothing counted)
 */
export function classifyShape(
  shares: LayerShares | null,
  tol: number = SHAPE_TOLERANCE
): PyramidShape {
  if (!shares) return "empty";
  const wider = (a: number, b: number) => a - b > tol + 1e-9;
  const { unit: u, integration: i, e2e: e } = shares;
  if (!wider(i, u) && !wider(e, i) && wider(u, e)) return "pyramid";
  if (!wider(i, e) && !wider(u, i) && wider(e, u)) return "ice-cream-cone";
  if (wider(u, i) && wider(e, i)) return "hourglass";
  if (wider(i, u) && wider(i, e)) return "diamond";
  return "even";
}

/**
 * Whole percents for the shares that add up to 100 (largest remainder), so
 * a verdict never reads 33% + 33% + 33%.
 */
export function sharePercents(shares: LayerShares): LayerValues {
  const raw = TEST_LAYERS.map((l) => shares[l] * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, k) => ({ k, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.k - b.k);
  for (const { k } of order) {
    if (left <= 0) break;
    out[k] += 1;
    left -= 1;
  }
  return { unit: out[0], integration: out[1], e2e: out[2] };
}

const SHAPE_READING: Record<Exclude<PyramidShape, "empty">, string> = {
  pyramid: "Most checks are the fast, cheap kind.",
  "ice-cream-cone": "Most checks run end to end, the slowest and flakiest layer.",
  hourglass: "The middle layer is thin.",
  diamond: "Integration tests carry the suite, as a testing trophy does.",
  even: `No layer stands out by more than ${Math.round(SHAPE_TOLERANCE * 100)} points.`,
};

/**
 * The verdict sentence, e.g. "Hourglass: 48% unit, 6% integration, 46%
 * e2e. The middle layer is thin." With runtime weighting the shares are of
 * run time, and the sentence says so.
 */
export function shapeVerdict(
  shape: PyramidShape,
  shares: LayerShares | null,
  weighting: TestPyramidWeighting = "count"
): string {
  if (shape === "empty" || !shares) {
    return weighting === "runtime"
      ? "Enter the minutes each layer takes to see the shape by run time."
      : "No tests counted yet.";
  }
  const p = sharePercents(shares);
  const basis = weighting === "runtime" ? " by run time" : "";
  return `${PYRAMID_SHAPE_LABEL[shape]}${basis}: ${p.unit}% unit, ${p.integration}% integration, ${p.e2e}% e2e. ${SHAPE_READING[shape]}`;
}

/** The 1 / 5 / 25 relative run cost of the counts: a unitless index, not money. */
export function relativeCost(counts: Partial<LayerValues>): number {
  return TEST_LAYERS.reduce(
    (acc, l) => acc + (isCount(counts[l]) ? (counts[l] as number) : 0) * RUN_COST_WEIGHTS[l],
    0
  );
}

export interface RunCost {
  /** "count": the 1 / 5 / 25 index; "runtime": minutes of CI time. */
  basis: TestPyramidWeighting;
  byLayer: LayerValues;
  total: number;
}

/**
 * What the suite costs to run per layer: the relative 1 / 5 / 25 index by
 * count, or the entered minutes by runtime. Null when runtime weighting
 * lacks a layer's minutes.
 */
export function runCost(
  counts: Partial<LayerValues>,
  weighting: TestPyramidWeighting = "count",
  runtime?: TestLayerRuntime | null
): RunCost | null {
  if (weighting === "runtime") {
    if (!hasAllRuntimes(runtime)) return null;
    const byLayer = { unit: runtime.unit, integration: runtime.integration, e2e: runtime.e2e };
    return { basis: "runtime", byLayer, total: byLayer.unit + byLayer.integration + byLayer.e2e };
  }
  const byLayer = {} as LayerValues;
  for (const l of TEST_LAYERS) {
    byLayer[l] = (isCount(counts[l]) ? (counts[l] as number) : 0) * RUN_COST_WEIGHTS[l];
  }
  return { basis: "count", byLayer, total: relativeCost(counts) };
}

/* ── Snapshots ─────────────────────────────────────────────────────────── */

/** A new snapshot's id. */
export function newSnapshotId(): string {
  return `tps_${nanoid(8)}`;
}

/**
 * Why a snapshot day can't be saved, or null: blank, not a date, or after
 * `today` (local "YYYY-MM-DD"). Backdating is fine.
 */
export function snapshotDayError(takenOn: string | null | undefined, today: string): string | null {
  const day = typeof takenOn === "string" ? takenOn.trim() : "";
  if (!day) return "Enter the day the counts are for.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isIsoDate(day)) return "Enter a date as YYYY-MM-DD.";
  if (day > today) return "The day can't be after today.";
  return null;
}

/** The document's snapshots, oldest first (a stored order is kept for one day). */
export function snapshotsOf(doc: Pick<TestPyramid, "snapshots"> | null | undefined) {
  const list = Array.isArray(doc?.snapshots) ? doc.snapshots : [];
  return list
    .map((s, k) => ({ s, k }))
    .sort((a, b) => (a.s.takenOn < b.s.takenOn ? -1 : a.s.takenOn > b.s.takenOn ? 1 : a.k - b.k))
    .map(({ s }) => s);
}

/** A snapshot of the document's counts (and runtimes, when any were entered) on `takenOn`. */
export function snapshotOf(
  doc: TestPyramid,
  takenOn: string,
  id: string,
  note?: string
): TestPyramidSnapshot {
  const runtime: TestLayerRuntime = {};
  for (const l of TEST_LAYERS) if (isCount(doc.runtime?.[l])) runtime[l] = doc.runtime?.[l];
  const trimmed = note?.trim();
  return {
    id,
    takenOn,
    unit: doc.unit,
    integration: doc.integration,
    e2e: doc.e2e,
    ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
    ...(trimmed ? { note: trimmed } : {}),
  };
}

/** The document with `snapshot` added in day order (after others on the same day). */
export function withSnapshot(doc: TestPyramid, snapshot: TestPyramidSnapshot): TestPyramid {
  return { ...doc, snapshots: snapshotsOf({ snapshots: [...(doc.snapshots ?? []), snapshot] }) };
}

/** The document without snapshot `id`, or null when it has none by that id. */
export function withoutSnapshot(doc: TestPyramid, id: string): TestPyramid | null {
  const list = doc.snapshots ?? [];
  if (!list.some((s) => s.id === id)) return null;
  return { ...doc, snapshots: list.filter((s) => s.id !== id) };
}

export interface ShapeHistoryPoint {
  id: string;
  takenOn: string;
  /** Null when weighing by runtime and the snapshot has no minutes for every layer. */
  shares: LayerShares | null;
  shape: PyramidShape | null;
  unitShare: number | null;
}

/**
 * Each snapshot's shape, oldest first, weighed as the document is now. A
 * snapshot without all three runtimes has no shape by runtime (null), never
 * one by count in the same series.
 */
export function shapeHistory(
  snapshots: readonly TestPyramidSnapshot[],
  weighting: TestPyramidWeighting = "count"
): ShapeHistoryPoint[] {
  return snapshotsOf({ snapshots: [...snapshots] }).map((s) => {
    const untimed = weighting === "runtime" && !hasAllRuntimes(s.runtime);
    const shares = untimed ? null : layerShares(s, weighting, s.runtime);
    return {
      id: s.id,
      takenOn: s.takenOn,
      shares,
      shape: untimed ? null : classifyShape(shares),
      unitShare: shares ? shares.unit : null,
    };
  });
}

/* ── Drafts ────────────────────────────────────────────────────────────── */

/** Why a counts draft can't be saved: every layer needs a whole number of 0 or more. */
export function countsErrors(
  draft: Partial<Record<TestLayer, string | number | null | undefined>>
): FormErrors<TestLayer> {
  const errors: FormErrors<TestLayer> = {};
  for (const l of TEST_LAYERS) {
    const n = parseNumber(draft[l] ?? undefined);
    if (n === undefined)
      errors[l] = `Enter the number of ${TEST_LAYER_LABEL[l].toLowerCase()} tests.`;
    else if (!Number.isInteger(n) || n < 0) errors[l] = "Enter a whole number of 0 or more.";
  }
  return errors;
}

/** Why a runtimes draft can't be saved: a minute value given must be 0 or more (each is optional). */
export function runtimeErrors(
  draft: Partial<Record<TestLayer, string | number | null | undefined>>
): FormErrors<TestLayer> {
  const errors: FormErrors<TestLayer> = {};
  for (const l of TEST_LAYERS) {
    const n = parseNumber(draft[l] ?? undefined);
    if (n !== undefined && !isCount(n)) errors[l] = "Enter minutes of 0 or more.";
  }
  return errors;
}
