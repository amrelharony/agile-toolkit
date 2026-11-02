"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { themed, tint } from "@/lib/utils/theme-color";

interface StatCardProps {
  /** Mandatory: short label (e.g. "Cycle avg", "Predictability"). */
  label: string;
  /**
   * The headline value. Accepts `React.ReactNode` so tools can adorn the
   * value with inline icons or trend chips (e.g. mood-tracker shows the
   * average score alongside a Heart icon).
   */
  value: React.ReactNode;
  /** Optional unit suffix that renders smaller next to the value (e.g. "d", "%"). */
  unit?: string;
  /** Sub-line under the value (e.g. "±1.2", "completed"). */
  hint?: string;
  /** Lucide icon. Optional — when present, drives the accent chip / inline icon. */
  icon?: LucideIcon;
  /** Colour for the icon + chip background (brand hexes follow the theme). Defaults to accent. */
  iconColor?: string;
  /**
   * Visual variant:
   *   - `default` (velocity-style): icon-chip + medium card, big numbers (text-3xl).
   *     Best for hero stats at the top of a tool, 2-4 across a row.
   *   - `compact` (kanban-style): inline icon next to label + smaller card,
   *     `font-data text-2xl`. Best for dense KPI rows.
   */
  variant?: "default" | "compact";
  /** Override the value's color (e.g. "text-accent" for emphasis). */
  valueClassName?: string;
  /** Additional classes to spread on the outer Card. */
  className?: string;
  /**
   * Semantic tone — applies a coordinated card background + border + value
   * colour. Use for state-driven KPIs (e.g. an "Overloads" tile that should
   * tint red when > 0 cap-violations exist). Defaults to `"default"` (the
   * neutral surface tones).
   *
   * `tone` is applied AFTER `className` and `valueClassName`, so explicit
   * overrides at the call site win — but most tools should reach for the
   * tone prop instead of duplicating the `bg-danger/5 border-danger/40`
   * class combo across files.
   */
  tone?: "default" | "danger" | "warning" | "success";
}

const TONE_CARD_CLASS: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-surface border-border",
  // R10: `danger` is not a defined Tailwind color → these classes
  // resolved to nothing and danger-tone stat cards had NO tint.
  // `destructive` is the shadcn-mapped, theme-aware token.
  danger: "bg-destructive/5 border-destructive/40",
  warning: "bg-warning/5 border-warning/40",
  success: "bg-success/5 border-success/40",
};

const TONE_VALUE_CLASS: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "",
  danger: "text-destructive",
  warning: "text-warning",
  success: "text-success",
};

/**
 * Unified KPI / stat tile used across every tool's hero strip.
 *
 * Replaces ~12 hand-rolled implementations. Two variants cover the two
 * shapes that exist today (velocity hero-stat with the colored chip, and
 * the more common kanban / dependency-map / scrum-of-scrums dense KPI
 * row). Picking a variant is a 1-word change; no inheritance gymnastics.
 *
 * Mobile-first: padding scales 16 → 20 px, label uses `text-xs` (≈ 12 px)
 * for readability on phones, value uses the existing px-anchored
 * `text-2xl`/`text-3xl` design tokens.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  iconColor,
  variant = "default",
  valueClassName,
  className,
  tone = "default",
}: StatCardProps) {
  const accent = iconColor ? themed(iconColor) : "var(--accent)";
  // Compose tone classes first so explicit `className` / `valueClassName`
  // overrides at the call site take precedence.
  const cardToneClass = TONE_CARD_CLASS[tone];
  const valueToneClass = TONE_VALUE_CLASS[tone];
  // For the icon chip we need a translucent tint of the icon color.
  const chipBg = tint(iconColor ?? "var(--accent)", 10);

  if (variant === "compact") {
    return (
      <Card className={cn(cardToneClass, className)}>
        <CardContent className="p-3 sm:p-4">
          <div className="text-xs text-sub mb-1 flex items-center gap-1 min-w-0">
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">{label}</span>
          </div>
          <div
            className={cn(
              // Fluid value — scales from ~1.25 rem on 320 px phones to
              // 1.5 rem on desktop — so dense KPI rows (2-up on phone) still
              // read cleanly without truncating multi-digit values.
              "font-data text-[clamp(1.25rem,3.5vw,1.5rem)] text-text break-words leading-tight",
              valueToneClass,
              valueClassName
            )}
          >
            {value}
            {unit && <span className="text-sub text-sm ml-1">{unit}</span>}
          </div>
          {hint && <div className="text-xs text-sub mt-1">{hint}</div>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(cardToneClass, className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 min-w-0">
          {Icon && (
            <div
              className="p-2 rounded-lg shrink-0"
              style={{ background: chipBg }}
              aria-hidden="true"
            >
              <Icon className="w-5 h-5" style={{ color: accent }} />
            </div>
          )}
          <span className="text-xs sm:text-sm text-sub truncate">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span
            className={cn(
              // Fluid value: 1.5 rem (24 px) on phones → 1.875 rem (30 px)
              // on desktop. Replaces the static text-2xl→text-3xl jump so
              // tiles breathe consistently across viewports.
              "font-data font-bold text-text text-[clamp(1.5rem,4vw,1.875rem)] leading-tight break-words",
              valueToneClass,
              valueClassName
            )}
          >
            {value}
          </span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
        </div>
        {hint && <div className="text-xs text-sub mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
