/**
 * Health Dashboard — how a traffic light looks: theme-token classes and a
 * label. The limits that decide the light live in lib/health-dashboard
 * (the team's thresholds, shared with the agent); the old fixed hex
 * colours here ignored the theme (white-on-white "No data" in light mode).
 */

import type { TrafficStatus } from "@/lib/health-dashboard/settings";

export const STATUS_LABEL: Record<TrafficStatus, string> = {
  green: "On track",
  amber: "Needs attention",
  red: "At risk",
};

/** The value's and the badge's text. */
export const STATUS_TEXT: Record<TrafficStatus, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-danger",
};

/** A card or badge tinted by its light. */
export const STATUS_SURFACE: Record<TrafficStatus, string> = {
  green: "border-success/25 bg-success/10",
  amber: "border-warning/25 bg-warning/10",
  red: "border-danger/25 bg-danger/10",
};

/** A solid dot or circle. */
export const STATUS_FILL: Record<TrafficStatus, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-danger",
};
