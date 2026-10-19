"use client";

/**
 * Summary stat tile for the CFD header row: label, big value + unit (with
 * warning/accent coloring), and an optional inline trailing element (trend chip).
 */

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  unit,
  accent = false,
  warning = false,
  trailing,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  warning?: boolean;
  /** Inline trailing element next to the value (e.g. trend chip). */
  trailing?: React.ReactNode;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <p className="text-xs text-sub mb-2">{label}</p>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span
            className={`text-2xl font-data font-bold ${
              warning ? "text-warning" : accent ? "text-accent" : "text-text"
            }`}
          >
            {value}
          </span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
          {trailing}
        </div>
      </CardContent>
    </Card>
  );
}
