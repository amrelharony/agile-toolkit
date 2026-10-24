/**
 * Impediment Tracker: how severity, status and age look. Theme tokens only
 * (the old maps carried fixed hex colours, unreadable on the light theme),
 * and every badge also says its state in words, so colour is never the
 * only signal. Labels come from lib/impediments/model. Pure data, no React.
 */

import type { ImpedimentSeverity } from "@/lib/stores/workspace-types";
import type { ImpedimentStatus } from "@/lib/impediments/model";

export const SEVERITY_TONE: Record<ImpedimentSeverity, string> = {
  low: "border-border text-sub",
  medium: "border-warning/40 text-warning",
  high: "border-danger/40 text-danger",
  critical: "border-danger/60 bg-danger/10 text-danger font-semibold",
};

export const STATUS_TONE: Record<ImpedimentStatus, string> = {
  open: "border-accent/40 text-accent",
  escalated: "border-warning/40 text-warning",
  resolved: "border-success/40 text-success",
};

/** Open this long it's worth a look; this long it's in the way of the sprint. */
export const AGE_WATCH_DAYS = 3;
export const AGE_ALARM_DAYS = 7;

export function ageTone(days: number): string {
  if (days >= AGE_ALARM_DAYS) return "border-danger/40 text-danger";
  if (days >= AGE_WATCH_DAYS) return "border-warning/40 text-warning";
  return "border-success/40 text-success";
}

/** Caps on what one row may hold, so a pasted essay can't fill the storage quota. */
export const TITLE_MAX = 240;
export const TEXT_MAX = 4000;
export const NAME_MAX = 120;
