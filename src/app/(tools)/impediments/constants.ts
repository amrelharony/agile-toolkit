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
    bg: "bg-[#00ff88]/10",
    border: "border-[#00ff88]/20",
  },
  Medium: {
    label: "Medium",
    color: "#ffaa00",
    bg: "bg-[#ffaa00]/10",
    border: "border-[#ffaa00]/20",
  },
  High: {
    label: "High",
    color: "#ef4444",
    bg: "bg-[#ef4444]/10",
    border: "border-[#ef4444]/20",
  },
  Critical: {
    label: "Critical",
    color: "#ef4444",
    bg: "bg-[#ef4444]/20",
    border: "border-[#ef4444]/40",
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
    bg: "bg-[#ffaa00]/10",
    border: "border-[#ffaa00]/20",
  },
  Resolved: {
    label: "Resolved",
    color: "#00ff88",
    bg: "bg-[#00ff88]/10",
    border: "border-[#00ff88]/20",
  },
};
