/**
 * Product Metrics as Markdown: the North Star with its inputs, HEART by
 * feature, the funnel's latest period, and every metric's last readings.
 */

import { HEART_CATEGORIES, type ProductMetric } from "@/lib/stores/workspace-types";
import { formatMetric } from "@/lib/hypotheses/model";
import {
  AARRR_LABEL,
  HEART_LABEL,
  changeText,
  funnelView,
  heartView,
  latestReading,
  latestText,
  metricChips,
  metricProgress,
  metricTrend,
  northStarView,
  pctText,
  pointsText,
  progressText,
  sortedReadings,
  trendText,
  usableMetrics,
} from "@/lib/product-metrics/model";

/** A table cell: no pipes or line breaks. */
const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();

const target = (m: ProductMetric) =>
  m.target !== undefined ? formatMetric(m.target, m.unit) : "—";

export function toMarkdown({
  metrics,
  productGoal,
}: {
  metrics: readonly ProductMetric[];
  productGoal: string | null;
}): string {
  const all = usableMetrics(metrics);
  const out: string[] = ["# Product Metrics", ""];
  if (productGoal) out.push(`Product Goal: ${cell(productGoal)}`, "");

  const { northStar, inputs } = northStarView(all);
  out.push("## North Star", "");
  if (northStar) {
    const latest = latestReading(northStar);
    out.push(`**${cell(northStar.name)}**`);
    if (northStar.definition) out.push("", cell(northStar.definition));
    out.push(
      "",
      `- Latest: ${latestText(northStar)}${latest ? ` (${latest.date})` : ""}`,
      `- Target: ${target(northStar)} · progress ${progressText(metricProgress(northStar))}`,
      `- ${trendText(metricTrend(northStar))}`,
      ""
    );
  } else {
    out.push("No North Star yet.", "");
  }
  if (inputs.length > 0) {
    out.push("| Input | Owner | Latest | Change | Target |", "| --- | --- | --- | --- | --- |");
    for (const m of inputs) {
      out.push(
        `| ${cell(m.name)} | ${cell(m.owner) || "—"} | ${cell(latestText(m))} | ${changeText(m) || "—"} | ${cell(target(m))} |`
      );
    }
    out.push("");
  }

  const heart = heartView(all);
  out.push("## HEART", "");
  if (heart.length === 0) out.push("No HEART goals yet.", "");
  for (const g of heart) {
    out.push(`### ${cell(g.feature)}`, "", "| Category | Goal | Signal | Metric | Latest |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const c of HEART_CATEGORIES) {
      const m = g.rows[c];
      if (!m) continue;
      out.push(
        `| ${HEART_LABEL[c]} | ${cell(m.heart?.goal) || "—"} | ${cell(m.heart?.signal) || "—"} | ${cell(m.name)} | ${cell(latestText(m))} |`
      );
    }
    out.push("");
  }

  const funnel = funnelView(all);
  out.push("## AARRR funnel", "");
  if (!funnel.date) {
    out.push("No funnel period yet.", "");
  } else {
    out.push(`Period: ${funnel.date}`, "");
    out.push(
      "| Stage | Count | Of the stage before | Of everyone acquired | Change |",
      "| --- | --- | --- | --- | --- |"
    );
    for (const s of funnel.stages) {
      const before =
        s.stage === "acquisition"
          ? "—"
          : `${pctText(s.ofBefore)}${s.stage === "referral" || s.stage === "revenue" ? " of Retention" : ""}`;
      out.push(
        `| ${AARRR_LABEL[s.stage]} | ${s.count ?? "—"} | ${before} | ${pctText(s.ofAcquired)} | ${pointsText(s.change) || "—"} |`
      );
    }
    out.push(
      "",
      funnel.nested
        ? funnel.leakiest
          ? `Leakiest stage: ${AARRR_LABEL[funnel.leakiest]}.`
          : "No leakiest stage yet."
        : "These counts don't nest: check the period's numbers.",
      ""
    );
  }

  out.push("## All metrics", "");
  if (all.length === 0) out.push("No metrics yet.", "");
  for (const m of all) {
    const chips = metricChips(m);
    out.push(`### ${cell(m.name)}${chips.length > 0 ? ` (${chips.join(", ")})` : ""}`, "");
    const last = sortedReadings(m).slice(-6);
    if (last.length === 0) out.push("No readings yet.", "");
    else {
      for (const r of last) out.push(`- ${r.date}: ${formatMetric(r.value, m.unit)}`);
      out.push("");
    }
  }
  return out.join("\n").trimEnd() + "\n";
}
