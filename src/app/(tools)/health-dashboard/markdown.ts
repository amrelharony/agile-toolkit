import type { HealthKpi, OverallHealth } from "@/lib/health-dashboard/kpis";
import { limitText, type HealthSettings } from "@/lib/health-dashboard/settings";
import { STATUS_LABEL } from "./status-config";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const value = (k: HealthKpi) => {
  if (k.value === null) return k.hasData ? "Not enough data" : "No data";
  if (k.unit === "percent") return `${k.value}%`;
  if (k.unit === "days") return `${k.value} ${k.value === 1 ? "day" : "days"}`;
  return String(k.value);
};

/**
 * The health report for a review or a status update: the verdict, the
 * overall score, each KPI with its light, the team's limits and where the
 * number comes from, and the windows it was read over. Replaces the old
 * plain-text summary, which hard-coded an 80% target whatever the team set.
 */
export function toMarkdown({
  kpis,
  overall,
  verdict,
  settings,
  today,
}: {
  kpis: readonly HealthKpi[];
  overall: OverallHealth;
  verdict: string;
  settings: HealthSettings;
  today: string;
}): string {
  const lines = [`# Team health — ${today}`, "", `**${md(verdict)}**`, ""];
  lines.push(
    overall.score === null
      ? "Overall: no KPI has a light yet."
      : `Overall: ${overall.score}% (${STATUS_LABEL[overall.status!]}), the average of ${overall.counted} of ${overall.total} KPIs.`,
    "",
    "| KPI | Value | Status | Green | Amber | Based on |",
    "|---|---:|---|---|---|---|",
    ...kpis.map(
      (k) =>
        `| ${md(k.name)} | ${value(k)} | ${k.status ? STATUS_LABEL[k.status] : "—"} | ${limitText(
          k.id,
          k.threshold.green
        )} | ${limitText(k.id, k.threshold.amber)} | ${md(k.detail ? `${k.basis} ${k.detail}` : k.basis)} |`
    ),
    "",
    `Windows: predictability over the latest ${settings.windows.sprintWindow} pointed sprints; standup blockers from the last ${settings.windows.blockerWindowDays} days; cycle time over work finished in the last ${settings.windows.cycleWindowDays} days.`
  );
  return `${lines.join("\n")}\n`;
}
