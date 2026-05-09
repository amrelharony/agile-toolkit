"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CalloutAlertProps {
  /**
   * Semantic tone — drives the border, background, and text colour.
   * Defaults to `"warning"` (amber) since the most common use is a
   * "heads-up" advisory; `danger` is for hard-error states (cycles
   * detected, WIP violated, blockers stale).
   */
  tone?: "danger" | "warning" | "info" | "success";
  /**
   * Icon glyph rendered to the left of the content. Defaults to a
   * tone-appropriate icon: AlertTriangle for danger/warning, Info for
   * info, CheckCircle2 for success. Pass `null` to suppress.
   */
  icon?: LucideIcon | null;
  /** Body content. */
  children: React.ReactNode;
  /** Pass-through (margin overrides, alignment, etc.). */
  className?: string;
  /**
   * ARIA role. Defaults to `"alert"` for `danger` and `"status"` for
   * everything else, matching the established WAI-ARIA pattern (alert =
   * urgent / dismissible-error, status = informational).
   */
  role?: "alert" | "status";
}

const TONE_CLASS: Record<NonNullable<CalloutAlertProps["tone"]>, string> = {
  danger: "border-danger/40 bg-danger/5 text-danger",
  warning: "border-amber-500/40 bg-amber-500/5 text-amber-200",
  info: "border-accent/40 bg-accent/5 text-accent",
  success: "border-emerald-500/40 bg-emerald-500/5 text-emerald-200",
};

const DEFAULT_ICON: Record<NonNullable<CalloutAlertProps["tone"]>, LucideIcon> = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

/**
 * Standardised inline alert/callout band used across the toolkit when a
 * tool needs to surface a transient, in-page advisory: WIP-limit
 * violation in kanban, stale blockers in scrum-of-scrums, lead-time
 * outliers in value-stream, dependency cycles in dependency-map, etc.
 *
 * Replaces the recurring inline pattern:
 *
 *   <div className="rounded-lg border border-danger/40 bg-danger/5
 *                   text-danger p-3 mb-4 flex items-start gap-2 text-xs">
 *     <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
 *     <div>...</div>
 *   </div>
 *
 * Mobile-first: the icon stays at the top-left while the text wraps
 * underneath on narrow screens — `flex items-start` + `mt-0.5` on the
 * icon keep the visual rhythm whether the message is one line or five.
 *
 * Accessibility: `role="alert"` on danger callouts so screen readers
 * announce them when they appear; `role="status"` (the default for
 * non-danger tones) is announced more politely via the live-region.
 */
export function CalloutAlert({
  tone = "warning",
  icon,
  children,
  className,
  role,
}: CalloutAlertProps) {
  // Resolve the icon: explicit null ⇒ no glyph; undefined ⇒ tone default;
  // explicit Lucide ⇒ use it.
  const Icon =
    icon === null ? null : icon ?? DEFAULT_ICON[tone];
  const computedRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <div
      role={computedRole}
      className={cn(
        "rounded-lg border p-3 flex items-start gap-2 text-xs",
        TONE_CLASS[tone],
        className
      )}
    >
      {Icon && <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
