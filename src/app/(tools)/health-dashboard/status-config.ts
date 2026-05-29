/**
 * Health Dashboard — traffic-light thresholds + presentation maps.
 *
 * Each `*Status` maps a raw KPI value (or null = "no data") to a traffic
 * status; the STATUS_* maps and TRAFFIC_SCORE turn that status into colors,
 * labels, and the weight used for the overall health roll-up. Pure data.
 */

import type { TrafficStatus } from "./types";

export function predictabilityStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v >= 80) return "green";
  if (v >= 60) return "amber";
  return "red";
}

export function healthPctStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v >= 75) return "green";
  if (v >= 50) return "amber";
  return "red";
}

export function openImpedimentsStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v === 0) return "green";
  if (v <= 3) return "amber";
  return "red";
}

export function criticalImpedimentsStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v === 0) return "green";
  return "red";
}

export function openBlockersStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v === 0) return "green";
  if (v <= 2) return "amber";
  return "red";
}

export function cycleTimeP85Status(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v <= 7) return "green";
  if (v <= 14) return "amber";
  return "red";
}

export const STATUS_COLOR: Record<TrafficStatus, string> = {
  green: "#22c55e",
  amber: "#eab308",
  red: "#ef4444",
};

export const STATUS_BG: Record<TrafficStatus, string> = {
  green: "rgba(34,197,94,0.1)",
  amber: "rgba(234,179,8,0.1)",
  red: "rgba(239,68,68,0.1)",
};

export const STATUS_BORDER: Record<TrafficStatus, string> = {
  green: "rgba(34,197,94,0.25)",
  amber: "rgba(234,179,8,0.25)",
  red: "rgba(239,68,68,0.25)",
};

export const STATUS_LABEL: Record<TrafficStatus, string> = {
  green: "On Track",
  amber: "Needs Attention",
  red: "At Risk",
};

/* Score weights for overall health */
export const TRAFFIC_SCORE: Record<TrafficStatus, number> = { green: 2, amber: 1, red: 0 };
