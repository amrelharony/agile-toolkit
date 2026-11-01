import { NO_VALUE } from "@/lib/charts/chart-text";
import {
  FLAKY_STATUS_LABEL,
  flakyRate,
  flakySummary,
  flakyVerdict,
  hasRunCounts,
  quarantinedDays,
  ratePercent,
} from "@/lib/quality/flaky";
import type { FlakyTest } from "@/lib/stores/workspace-types";
import { compareTests } from "./view";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The scoreboard as Markdown: the verdict, the tests quarantined too long,
 * and one row per test, highest rate first (a row from before run counts
 * shows its rate with "—" for the counts).
 */
export function flakyMarkdown(tests: readonly FlakyTest[], today: string): string {
  const summary = flakySummary(tests, today);
  const lines = ["# Flaky tests", "", `> ${flakyVerdict(summary)}`, ""];
  if (summary.longQuarantined.length > 0) {
    lines.push("## Quarantined too long", "");
    for (const q of summary.longQuarantined) lines.push(`- ${md(q.name)}: ${q.days} days`);
    lines.push("");
  }
  if (tests.length === 0) return `${lines.join("\n").trimEnd()}\n`;
  lines.push(
    "| Test | Suite | Owner | Failures | Runs | Rate | Status | Quarantined (days) | First seen |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const t of [...tests].sort(compareTests("rate"))) {
    const rate = flakyRate(t);
    const days = quarantinedDays(t, today);
    lines.push(
      `| ${[
        md(t.name),
        md(t.suite) || NO_VALUE,
        md(t.owner) || NO_VALUE,
        hasRunCounts(t) ? t.failures : NO_VALUE,
        hasRunCounts(t) ? t.runs : NO_VALUE,
        rate === null ? NO_VALUE : ratePercent(rate),
        FLAKY_STATUS_LABEL[t.status],
        t.status !== "quarantined" ? "" : days === null ? "date unknown" : days,
        t.firstSeenAt,
      ].join(" | ")} |`
    );
  }
  return `${lines.join("\n")}\n`;
}
