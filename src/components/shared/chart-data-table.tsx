"use client";

import { useEffect, useId, useRef, useState } from "react";
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

/** Cell padding: tighter on a phone, so a five-column table nearly fits a card. */
const CELL_PAD = "px-2 py-2 sm:px-3";
/**
 * The first column stays put while the rest scroll under it, so each row keeps
 * its name ("Day 3") in view. The card's colour hides what slides beneath.
 */
const STICKY_COL = "sticky left-0 z-[1] bg-card";

/**
 * Whether the region has more to show to its right, and how tall its caption
 * is (the fade starts below it, so the caption's words aren't faded).
 */
function useMoreToTheRight(table: ChartTable) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLTableCaptionElement>(null);
  const [more, setMore] = useState(false);
  const [captionHeight, setCaptionHeight] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      // A pixel of slack: scrollLeft is fractional on high-density screens.
      setMore(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
      setCaptionHeight(captionRef.current?.offsetHeight ?? 0);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [table]);
  return { scrollRef, captionRef, more, captionHeight };
}

/**
 * A chart's data as a real table: a caption, a header row of `<th scope="col">`,
 * and each row named by its first cell (`<th scope="row">`), so a screen reader
 * announces "Day 3, Remaining, 27" as it moves through the cells.
 *
 * The wrapper scrolls sideways on a narrow screen. It's a labelled, focusable
 * region so a keyboard user can scroll it too. While columns are hidden to the
 * right, its right edge fades out (the cue that it scrolls), and the row names
 * stay pinned on the left.
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
  const { scrollRef, captionRef, more, captionHeight } = useMoreToTheRight(table);
  return (
    // `isolate` keeps the pinned column's and the fade's z-index inside the table.
    <div className={cn("relative isolate", className)}>
      <div
        ref={scrollRef}
        id={id}
        role="region"
        aria-labelledby={captionId}
        // Focusable so the keyboard can scroll a table wider than the screen.
        tabIndex={0}
        className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <table className="w-full text-sm">
          <caption ref={captionRef} id={captionId} className="pb-2 text-left text-xs text-sub">
            {table.caption ?? fallbackCaption}
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-sub">
              {table.columns.map((col, c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap font-medium",
                    CELL_PAD,
                    align(c),
                    c === 0 && STICKY_COL
                  )}
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
                      className={cn(
                        "whitespace-nowrap text-left font-medium text-text",
                        CELL_PAD,
                        STICKY_COL
                      )}
                    >
                      {value}
                    </th>
                  ) : (
                    <td key={c} className={cn("font-data text-text", CELL_PAD, align(c))}>
                      {value}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <div
          aria-hidden="true"
          data-scroll-fade=""
          // A pixel in from the edge, so the region's inset focus ring still shows.
          className="pointer-events-none absolute bottom-px right-px z-[2] w-8 rounded-r-md bg-gradient-to-l from-card"
          style={{ top: captionHeight }}
        />
      )}
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
