"use client";

/**
 * Small presentational badges for the Impediment Tracker: age (color-graded by
 * days open), severity, and status. All styling derives from the shared
 * SEVERITY_CONFIG / STATUS_CONFIG maps.
 */

import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Severity, Status } from "../types";
import { SEVERITY_CONFIG, STATUS_CONFIG } from "../constants";

export function AgeIndicator({ days }: { days: number }) {
  const color = days < 3 ? "#00ff88" : days < 7 ? "#ffaa00" : "#ef4444";
  return (
    <span className="flex items-center gap-1 text-xs font-data" style={{ color }}>
      <Clock className="w-3 h-3" />
      {days}d
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <Badge
      className={`${cfg.bg} border ${cfg.border} text-xs font-medium ${
        severity === "Critical" ? "font-bold" : ""
      }`}
      style={{ color: cfg.color }}
    >
      {cfg.label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Badge className={`${cfg.bg} border ${cfg.border} text-xs`} style={{ color: cfg.color }}>
      {cfg.label}
    </Badge>
  );
}
