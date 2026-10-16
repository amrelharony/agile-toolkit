"use client";

/**
 * Compact stat tile for the cycle-time summary row: label, big value + unit,
 * an optional inline trailing element (trend chip) and a sub-line footer
 * (bootstrap CI bracket).
 */

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  unit,
  accent = false,
  trailing,
  footer,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  /** Inline trailing element next to the value (e.g. trend chip). */
  trailing?: React.ReactNode;
  /** Sub-line under the value (e.g. bootstrap CI bracket "± [2, 6]"). */
  footer?: React.ReactNode;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <p className="text-xs text-sub mb-2">{label}</p>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={`text-2xl font-data font-bold ${accent ? "text-accent" : "text-text"}`}>
            {value}
          </span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
          {trailing}
        </div>
        {footer && <div className="mt-1 text-xs text-sub font-mono">{footer}</div>}
      </CardContent>
    </Card>
  );
}
