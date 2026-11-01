import type { NpsResponse } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  periodSeries,
  summarizeCsat,
  summarizeNps,
  tagCounts,
  type SurveyPeriod,
} from "@/lib/nps/score";
import { periodTrendText } from "./chart-text";
import { isUnhappy, tagCsatText, tagNpsText } from "./tags";
import { surveyVerdict } from "./verdict";

/** The most unhappy verbatims listed. */
export const MD_VERBATIMS = 20;

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
}

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

/**
 * The survey results for a review page: the verdict, NPS and CSAT with
 * their n, every period with its n (thin ones marked), the themes, and the
 * latest unhappy verbatims. `responses` are the ones on screen (the tag
 * filter applies); `today` runs the periods on to today's.
 */
export function toMarkdown(
  responses: readonly NpsResponse[],
  by: SurveyPeriod,
  { now = new Date(), today, tag }: { now?: Date; today: string; tag?: string | null }
): string {
  const title = `# NPS / CSAT${tag ? ` — “${cell(tag)}”` : ""} — ${mdDate(now)}`;
  if (responses.length === 0) return `${title}\n\nNo responses yet.\n`;
  const series = periodSeries(responses, by, { through: today });
  const nps = summarizeNps(responses);
  const csat = summarizeCsat(responses);
  const lines = [
    title,
    "",
    `**${surveyVerdict(series.points, { nps, csat })}**`,
    "",
    `- NPS: ${nps.score === null ? "no NPS responses" : `${signed(nps.score)} from ${nps.n} (${nps.promoters} promoters, ${nps.passives} passives, ${nps.detractors} detractors)`}`,
    `- CSAT: ${csat.satisfiedPct === null ? "no CSAT responses" : `${csat.satisfiedPct}% satisfied from ${csat.n} (average ${csat.average} of 5)`}`,
  ];
  if (series.undated > 0)
    lines.push(
      `- ${series.undated} response${series.undated === 1 ? " has" : "s have"} no valid date: counted, in no period.`
    );
  if (series.offScale > 0)
    lines.push(
      `- ${series.offScale} response${series.offScale === 1 ? " has a score" : "s have scores"} off the scale: left out.`
    );

  if (series.points.length > 0) {
    const table = periodTrendText(series.points, by).table;
    lines.push(
      "",
      `## By ${by}`,
      "",
      `Periods with fewer than ${MIN_SAMPLE.surveyPeriod} responses of a kind are marked: one answer moves them a lot.`,
      "",
      `| ${table.columns.join(" | ")} |`,
      `|---|${table.columns
        .slice(1)
        .map(() => "---:")
        .join("|")}|`,
      ...table.rows.map((r) => `| ${r.map(cell).join(" | ")} |`)
    );
  }

  const tags = tagCounts(responses);
  if (tags.length > 0) {
    lines.push(
      "",
      "## Themes",
      "",
      "| Tag | Responses | Unhappy | NPS | CSAT % satisfied |",
      "|---|---:|---:|---:|---:|",
      ...tags.map(
        (t) => `| ${cell(t.tag)} | ${t.n} | ${t.unhappy} | ${tagNpsText(t)} | ${tagCsatText(t)} |`
      )
    );
  }

  const unhappy = responses
    .filter((r) => isUnhappy(r) && r.verbatim?.trim())
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MD_VERBATIMS);
  if (unhappy.length > 0) {
    lines.push(
      "",
      "## What unhappy customers said",
      "",
      ...unhappy.map(
        (r) =>
          `- ${cell(String(r.date).slice(0, 10))}, ${r.kind.toUpperCase()} ${r.score}${
            r.tags?.length ? ` [${r.tags.map(cell).join(", ")}]` : ""
          }: “${cell(r.verbatim)}”`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
