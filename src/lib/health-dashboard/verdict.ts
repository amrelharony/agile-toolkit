/**
 * The health dashboard's one-sentence answer: which KPIs need attention and
 * why, worst first, against the team's own limits. The page shows it above
 * the cards; the Markdown export and tool.health_dashboard.get_summary
 * quote it, so a report and an agent say the same thing.
 */

import { daysText, limitText } from "./settings";
import type { HealthKpi } from "./kpis";

const SHOWN = 2;

/** "cycle time P85 is 12 days (green up to 7 days)": one KPI's reading against its green limit. */
export function kpiReading(k: HealthKpi): string {
  const limit = `green ${limitText(k.id, k.threshold.green)}`;
  const v = k.value as number;
  switch (k.id) {
    case "predictability":
      return `predictability is ${v}% (${limit})`;
    case "team-health":
      return `team health is ${v}% (${limit})`;
    case "open-impediments":
      return `${v} ${v === 1 ? "impediment is" : "impediments are"} open (${limit})`;
    case "critical-impediments":
      return `${v} critical ${v === 1 ? "impediment is" : "impediments are"} open (${limit})`;
    case "open-blockers":
      return `${v} standup ${v === 1 ? "blocker is" : "blockers are"} open (${limit})`;
    case "cycle-time-p85":
      return `cycle time P85 is ${daysText(v)} (${limit})`;
  }
}

const listAnd = (parts: string[]) =>
  parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 *   "2 of 5 KPIs need attention: cycle time P85 is 12 days (green up to 7
 *    days) and 3 standup blockers are open (green up to 0)."
 *   "All 6 KPIs are on track."
 *   "No KPI has enough data yet."
 */
export function healthVerdict(kpis: readonly HealthKpi[]): string {
  const lit = kpis.filter((k) => k.status !== null);
  if (lit.length === 0) return "No KPI has enough data yet.";
  const waiting = kpis.length - lit.length;
  const pending = waiting > 0 ? `; ${waiting} more ${waiting === 1 ? "needs" : "need"} data` : "";
  // Red before amber; within each, the dashboard's order.
  const attention = [
    ...lit.filter((k) => k.status === "red"),
    ...lit.filter((k) => k.status === "amber"),
  ];
  if (attention.length === 0) {
    return lit.length === 1
      ? `The one KPI with data is on track${pending}.`
      : `All ${lit.length} KPIs with data are on track${pending}.`;
  }
  const named = attention.slice(0, SHOWN).map(kpiReading);
  const rest = attention.length - named.length;
  if (rest > 0) named.push(`${rest} more`);
  const head =
    lit.length === 1
      ? "The one KPI with data needs attention"
      : attention.length === 1
        ? `1 of ${lit.length} KPIs needs attention`
        : `${attention.length} of ${lit.length} KPIs need attention`;
  return `${head}: ${listAnd(named)}${pending}.`;
}
