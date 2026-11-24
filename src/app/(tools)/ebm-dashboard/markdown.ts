/**
 * The EBM Dashboard as Markdown: the goal ladder, each key value area's
 * measures and progress, the experiments, and the last three reviews.
 */

import {
  EBM_VALUE_AREAS,
  type EbmBoard,
  type Hypothesis,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import { formatMetric } from "@/lib/hypotheses/model";
import { latestText, metricProgress, metricTrend, progressText } from "@/lib/product-metrics/model";
import {
  AREA_LABEL,
  EBM_CREDIT,
  areaProgress,
  experimentsFor,
  reviewsNewestFirst,
  scoreText,
  type GoalLadder,
} from "@/lib/ebm/model";
import { SOURCE_INFO } from "@/lib/ebm/source-info";

const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export function toMarkdown({
  ladder,
  byArea,
  board,
  hypotheses,
}: {
  ladder: GoalLadder;
  byArea: Record<(typeof EBM_VALUE_AREAS)[number], readonly ProductMetric[]>;
  board: EbmBoard | null;
  hypotheses: readonly Hypothesis[];
}): string {
  const out: string[] = ["# EBM Dashboard", "", `_${EBM_CREDIT}_`, "", "## Goals", ""];
  out.push(
    `- Strategic goal: ${ladder.strategic ? cell(ladder.strategic.goal) : "not written yet"}`,
    ...(ladder.strategic?.why ? [`  - Why: ${cell(ladder.strategic.why)}`] : []),
    `- Intermediate goal (Product Goal): ${ladder.intermediate ? cell(ladder.intermediate.statement) : "none active"}`,
    `- Immediate tactical goal: ${ladder.tactical ? `${cell(ladder.tactical.goal)} (${cell(ladder.tactical.sprintName)})` : "no sprint goal yet"}`,
    ""
  );
  for (const area of EBM_VALUE_AREAS) {
    const measures = byArea[area] ?? [];
    out.push(
      `## ${AREA_LABEL[area]}`,
      "",
      `Area progress: ${scoreText(areaProgress(measures))}`,
      ""
    );
    if (measures.length === 0) {
      out.push("No measures yet.", "");
      continue;
    }
    out.push(
      "| Measure | Latest | Target | Progress | Trend | Source |",
      "| --- | --- | --- | --- | --- | --- |"
    );
    for (const m of measures) {
      const trend = metricTrend(m).word ?? "—";
      out.push(
        `| ${cell(m.name)} | ${cell(latestText(m))} | ${m.target !== undefined ? cell(formatMetric(m.target, m.unit)) : "—"} | ${progressText(metricProgress(m))} | ${trend} | ${m.source ? SOURCE_INFO[m.source].tool : "typed"} |`
      );
    }
    out.push("");
    const experiments = experimentsFor(measures, hypotheses);
    if (experiments.length > 0) {
      out.push("Experiments:", "");
      for (const e of experiments) {
        out.push(`- ${cell(e.hypothesis.believe)} (${e.hypothesis.status})`);
      }
      out.push("");
    }
  }
  out.push("## Reviews", "");
  const reviews = reviewsNewestFirst(board).slice(0, 3);
  if (reviews.length === 0) out.push("No review yet.", "");
  for (const r of reviews) {
    const areas = EBM_VALUE_AREAS.map((a) => `${AREA_LABEL[a]} ${scoreText(r.areas[a])}`).join(
      ", "
    );
    out.push(`### ${r.date}: focus on ${AREA_LABEL[r.focus]}`, "", areas);
    if (r.note) out.push("", cell(r.note));
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
