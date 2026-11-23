/**
 * What each toolkit source a metric can read is: its name, area, unit,
 * direction and the tool it comes from. Apart from the readers in
 * ./sources, so the next steps can name a source without loading them.
 */

import type { EbmValueArea, MetricDirection, MetricSourceId } from "@/lib/stores/workspace-types";

export interface SourceInfo {
  label: string;
  area: EbmValueArea;
  unit?: string;
  direction: MetricDirection;
  /** The tool it is read from, and its page. */
  tool: string;
  href: string;
}

export const SOURCE_INFO: Record<MetricSourceId, SourceInfo> = {
  "cycle-time-median": {
    label: "Median cycle time, last 90 days",
    area: "time-to-market",
    unit: "days",
    direction: "decrease",
    tool: "Cycle Time",
    href: "/cycle-time",
  },
  "dora-lead-time": {
    label: "Lead time for changes (DORA)",
    area: "time-to-market",
    unit: "days",
    direction: "decrease",
    tool: "DORA Scorecard",
    href: "/dora-scorecard",
  },
  "dora-deploys": {
    label: "Deploys a week (DORA)",
    area: "time-to-market",
    unit: "deploys",
    direction: "increase",
    tool: "DORA Scorecard",
    href: "/dora-scorecard",
  },
  "dora-change-fail": {
    label: "Change failure rate (DORA)",
    area: "ability-to-innovate",
    unit: "%",
    direction: "decrease",
    tool: "DORA Scorecard",
    href: "/dora-scorecard",
  },
  "nps-90d": {
    label: "NPS, last 90 days",
    area: "current-value",
    direction: "increase",
    tool: "NPS & CSAT",
    href: "/nps-csat",
  },
  "open-tech-debt": {
    label: "Open tech debt items",
    area: "ability-to-innovate",
    unit: "items",
    direction: "decrease",
    tool: "Tech Debt",
    href: "/tech-debt",
  },
};
