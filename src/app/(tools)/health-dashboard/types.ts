/**
 * Health Dashboard — shared types for the aggregate KPI view.
 *
 * The dashboard is a read-only roll-up: it derives KPIs from other tools'
 * persisted state (see extractors.ts) and never owns state of its own.
 */

import type { ElementType } from "react";

export type TrafficStatus = "green" | "amber" | "red";
export type TrendDir = "up" | "down" | "same";

export interface KPI {
  id: string;
  name: string;
  value: number | null;
  unit: string;
  status: TrafficStatus;
  trend: TrendDir;
  sourcePath: string;
  sourceName: string;
  icon: ElementType;
  iconColor: string;
  description: string;
  /**
   * Optional time-series for the metric. When present and length >= 5, the
   * KPI card renders a Mann-Kendall trend chip beside the trend arrow.
   */
  series?: number[];
  /** Whether an upward trend is "good" (predictability) or "bad" (impediments). */
  positiveIsGood?: boolean;
}

export interface DataSourceStatus {
  key: string;
  label: string;
  path: string;
  hasData: boolean;
}
