import type { DoraSample } from "@/lib/stores/workspace-types";
import {
  DORA_BANDS,
  DORA_BAND_ORDER,
  DORA_METRICS,
  DORA_METRIC_LABEL,
  bandRanges,
  bandsCitation,
  doraBand,
  formatMetric,
} from "@/lib/dora/bands";
import { latestSample, sortSamples } from "@/lib/dora/samples";
import { provenanceText } from "@/lib/dora/derive";
import { doraVerdict } from "@/lib/dora/verdict";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const sourceOf = (s: DoraSample) =>
  s.source === "derived"
    ? s.derivedFrom
      ? provenanceText(s.derivedFrom)
      : "From the data"
    : "Typed";

/**
 * The scorecard for a quarterly review: the verdict, the latest quarter's
 * four metrics with their bands, every quarter (newest first) with where
 * its numbers came from, and the band table with the report it cites.
 */
export function toMarkdown(samples: readonly DoraSample[]): string {
  const lines = ["# DORA Scorecard", ""];
  if (samples.length === 0) {
    lines.push("No quarters logged yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`**${doraVerdict(samples)}**`, "", `Bands: ${bandsCitation()}.`, "");
  const latest = latestSample(samples);
  if (latest) {
    lines.push(
      `## ${latest.quarter}`,
      "",
      "| Metric | Value | Band |",
      "|---|---|---|",
      ...DORA_METRICS.map(
        (m) =>
          `| ${DORA_METRIC_LABEL[m]} | ${formatMetric(m, latest[m])} | ${doraBand(m, latest[m]) ?? "—"} |`
      ),
      ""
    );
  }
  lines.push(
    "## Quarters",
    "",
    "| Quarter | Deploys a week | Lead time | Change failure | Time to restore | Source | Notes |",
    "|---|---:|---:|---:|---:|---|---|",
    ...[...sortSamples(samples)]
      .reverse()
      .map(
        (s) =>
          `| ${md(s.quarter)} | ${DORA_METRICS.map((m) => formatMetric(m, s[m])).join(" | ")} | ${md(
            sourceOf(s)
          )} | ${md(s.description) || "—"} |`
      ),
    "",
    `## Bands (${DORA_BANDS.report} ${DORA_BANDS.year})`,
    "",
    `| Band | ${DORA_METRICS.map((m) => DORA_METRIC_LABEL[m]).join(" | ")} |`,
    `|---|${DORA_METRICS.map(() => "---").join("|")}|`,
    ...DORA_BAND_ORDER.map((band, i) => {
      const cells = DORA_METRICS.map((m) => bandRanges(m)[i].range);
      return `| ${band} | ${cells.join(" | ")} |`;
    }),
    "",
    md(DORA_BANDS.note)
  );
  return `${lines.join("\n")}\n`;
}
