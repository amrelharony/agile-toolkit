"use client";

/**
 * Summary stat tile for the CFD header row: label, big value + unit (with
 * warning/accent colouring), and an optional sub-line footer.
 */

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  unit,
  accent = false,
  warning = false,
  footer,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  warning?: boolean;
  /** Sub-line under the value (e.g. the measured cycle time). */
  footer?: React.ReactNode;
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
        </div>
        {footer && <p className="mt-1 text-xs text-sub">{footer}</p>}
      </CardContent>
    </Card>
  );
}
