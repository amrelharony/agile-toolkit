import {
  TEST_LAYERS,
  TEST_LAYER_LABEL,
  classifyShape,
  layerShares,
  runCost,
  shapeVerdict,
  sharePercents,
  snapshotsOf,
  weightingOf,
} from "@/lib/quality/pyramid";
import { NO_VALUE } from "@/lib/charts/chart-text";
import type { TestPyramid } from "@/lib/stores/workspace-types";
import { count, minutes, shapePoints } from "./view";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The pyramid as Markdown: the shape verdict, a row per layer (count, share
 * by the weighting in use, run cost) and the snapshots, oldest first.
 */
export function pyramidMarkdown(doc: TestPyramid | null): string {
  const lines = ["# Test pyramid", ""];
  if (!doc) return `${[...lines, "No tests counted yet."].join("\n")}\n`;
  const weighting = weightingOf(doc);
  const shares = layerShares(doc, weighting, doc.runtime);
  const percents = shares ? sharePercents(shares) : null;
  const cost = runCost(doc, weighting, doc.runtime);
  lines.push(`> ${shapeVerdict(classifyShape(shares), shares, weighting)}`, "");
  if (doc.description?.trim()) lines.push(md(doc.description), "");

  const costHead = cost?.basis === "runtime" ? "Run time" : "Relative run cost";
  const shareHead = weighting === "runtime" ? "Share of run time" : "Share of tests";
  lines.push(`| Layer | Tests | ${shareHead} | ${costHead} |`, "| --- | --- | --- | --- |");
  for (const l of TEST_LAYERS) {
    const c = cost
      ? cost.basis === "runtime"
        ? minutes(cost.byLayer[l])
        : count(cost.byLayer[l])
      : NO_VALUE;
    lines.push(
      `| ${TEST_LAYER_LABEL[l]} | ${count(doc[l])} | ${percents ? `${percents[l]}%` : NO_VALUE} | ${c} |`
    );
  }
  lines.push("");

  const snapshots = snapshotsOf(doc);
  if (snapshots.length > 0) {
    const points = new Map(shapePoints(snapshots, weighting).map((p) => [p.id, p]));
    lines.push(
      "## Snapshots",
      "",
      "| Day | Unit | Integration | E2E | Shape | Note |",
      "| --- | --- | --- | --- | --- | --- |"
    );
    for (const s of snapshots) {
      lines.push(
        `| ${s.takenOn} | ${count(s.unit)} | ${count(s.integration)} | ${count(s.e2e)} | ${md(points.get(s.id)?.shape)} | ${md(s.note)} |`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
