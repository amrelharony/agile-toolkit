/**
 * Impediment Tracker — severity/status presentation maps (label + palette
 * tokens) used by the badge components. Pure data, no React.
 */

import type { Severity, Status } from "./types";

export const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; color: string; bg: string; border: string }
> = {
  Low: {
    label: "Low",
    color: "#00ff88",
    bg: "bg-accent-green/10",
    border: "border-accent-green/20",
  },
  Medium: {
    label: "Medium",
    color: "#ffaa00",
    bg: "bg-accent-amber/10",
    border: "border-accent-amber/20",
  },
  High: {
    label: "High",
    color: "#ef4444",
    bg: "bg-danger/10",
    border: "border-danger/20",
  },
  Critical: {
    label: "Critical",
    color: "#ef4444",
    bg: "bg-danger/20",
    border: "border-danger/40",
  },
};

export const STATUS_CONFIG: Record<
  Status,
  { label: string; color: string; bg: string; border: string }
> = {
  Open: {
    label: "Open",
    color: "#00f0ff",
    bg: "bg-accent/10",
    border: "border-accent/20",
  },
  Escalated: {
    label: "Escalated",
    color: "#ffaa00",
    bg: "bg-accent-amber/10",
    border: "border-accent-amber/20",
  },
  Resolved: {
    label: "Resolved",
    color: "#00ff88",
    bg: "bg-accent-green/10",
    border: "border-accent-green/20",
  },
};
