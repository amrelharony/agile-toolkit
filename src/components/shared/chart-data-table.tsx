"use client";

import { useId } from "react";
import { Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NO_VALUE, type ChartTable } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";

export type { ChartTable } from "@/lib/charts/chart-text";

/** A column is numeric when every cell is a number or a gap: those align right. */
function numericColumns(table: ChartTable): boolean[] {
  return table.columns.map(
    (_, c) =>
      c > 0 &&
      table.rows.some((row) => typeof row[c] === "number") &&
      table.rows.every((row) => typeof row[c] === "number" || row[c] === NO_VALUE || row[c] === "")
  );
}

/**
 * A chart's data as a real table: a caption, a header row of `<th scope="col">`,
 * and each row named by its first cell (`<th scope="row">`), so a screen reader
 * announces "Day 3, Remaining, 27" as it moves through the cells.
 *
 * The wrapper scrolls sideways on a narrow screen. It's a labelled, focusable
 * region so a keyboard user can scroll it too.
 */
export function ChartDataTable({
  table,
  id,
  fallbackCaption = "Chart data",
  className,
}: {
  table: ChartTable;
  /** The id a "View as table" toggle points its aria-controls at. */
  id?: string;
  /** Caption when the table has none (usually the chart's title). */
  fallbackCaption?: string;
  className?: string;
}) {
  const captionId = useId();
  const numeric = numericColumns(table);
  const align = (c: number) => (numeric[c] ? "text-right" : "text-left");
  return (
    <div
      id={id}
      role="region"
      aria-labelledby={captionId}
      // Focusable so the keyboard can scroll a table wider than the screen.
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        className
      )}
    >
      <table className="w-full text-sm">
        <caption id={captionId} className="pb-2 text-left text-xs text-sub">
          {table.caption ?? fallbackCaption}
        </caption>
        <thead>
          <tr className="border-b border-border text-xs text-sub">
            {table.columns.map((col, c) => (
              <th
                key={c}
                scope="col"
                className={cn("whitespace-nowrap px-3 py-2 font-medium", align(c))}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-0">
              {row.map((value, c) =>
                c === 0 ? (
                  <th
                    key={c}
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-medium text-text"
                  >
                    {value}
                  </th>
                ) : (
                  <td key={c} className={cn("px-3 py-2 font-data text-text", align(c))}>
                    {value}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The "View as table" disclosure. The label stays the same and `aria-expanded`
 * carries the state (the button looks pressed while the table shows).
 */
export function ChartTableToggle({
  expanded,
  controls,
  onToggle,
}: {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      // Matches the AI Prompts and Export buttons it usually sits beside.
      variant="outline"
      size="sm"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "gap-2 border-border text-sub hover:border-accent/30 hover:bg-accent/5 hover:text-text",
        expanded && "border-accent/40 bg-accent/10 text-accent hover:bg-accent/10 hover:text-accent"
      )}
    >
      <Table2 aria-hidden="true" />
      View as table
    </Button>
  );
}
