"use client";

import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartDataTable, ChartTableToggle } from "@/components/shared/chart-data-table";
import type { ChartTable } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";

// Loaded with the chart, not the page: a static import here pulled all of
// Recharts into every tool that renders a ChartCard, even when its chart
// is below the fold. Tools load their chart bodies the same way (see
// components/charts/lazy-chart.tsx).
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), {
  ssr: false,
});

// The <Card> look on a <figure> (Card itself only renders a <div>).
const CARD_CLASS = "panel text-card-foreground";

/* -------------------------------------------------------------------------- */
/*  Text alternative: summary + "View as table"                                */
/* -------------------------------------------------------------------------- */

/**
 * State shared by ChartCard and ChartFigure.
 *
 * Accessibility approach: once a chart has a summary or a table, the plot is
 * `aria-hidden`. The summary is visible text and the figure's description, so
 * labelling the plot `role="img"` with the same sentence would read it twice,
 * and the SVG's tick labels and legend are noise next to a real table. Charts
 * given a summary or table must turn off Recharts' `accessibilityLayer`, which
 * otherwise makes the SVG a tab stop (a focusable element inside aria-hidden).
 */
function useChartAlternative(summary: string | undefined, table: ChartTable | undefined) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const hasRows = Boolean(table && table.rows.length > 0);
  // A table that empties while open closes with it.
  const tableOpen = open && hasRows;
  const tableId = `${id}-table`;
  return {
    titleId: `${id}-title`,
    summaryId: summary ? `${id}-summary` : undefined,
    tableId,
    tableOpen,
    hidePlot: Boolean(summary || table),
    toggle: hasRows ? (
      <ChartTableToggle
        expanded={tableOpen}
        controls={tableId}
        onToggle={() => setOpen((o) => !o)}
      />
    ) : null,
  };
}

/** Classes that hide the plot while the table shows, at its full size. */
const PLOT_HIDDEN = "invisible absolute inset-x-0 top-0";

/**
 * The plot with the table swapped in. While the table shows, the plot stays
 * mounted at the same width and height, invisible and out of the flow, so
 * Recharts' ResponsiveContainer never measures a 0×0 box (as `display: none`
 * would make it) and the chart comes back without a redraw.
 */
function PlotWithTable({
  table,
  tableId,
  tableOpen,
  caption,
  children,
}: {
  table: ChartTable | undefined;
  tableId: string;
  tableOpen: boolean;
  caption: string | undefined;
  /** The plot element (already carrying PLOT_HIDDEN when the table is open). */
  children: React.ReactNode;
}) {
  if (!table) return <>{children}</>;
  return (
    <div className={cn("relative", tableOpen && "overflow-hidden")}>
      {children}
      {tableOpen && <ChartDataTable id={tableId} table={table} fallbackCaption={caption} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ChartCard                                                                  */
/* -------------------------------------------------------------------------- */

interface ChartCardProps {
  /** Card title — short, descriptive. Names the figure. */
  title: React.ReactNode;
  /** Optional Lucide icon rendered to the left of the title. */
  icon?: LucideIcon;
  /** Optional badge (e.g. "experimental", "live") to the right of the title. */
  badge?: React.ReactNode;
  /**
   * Slot rendered to the right of the title (e.g. AI Prompt + Export
   * buttons embedded in the card header — burndown / burnup / velocity
   * use this pattern).
   */
  headerExtras?: React.ReactNode;
  /**
   * Chart height in CSS pixels (number) or any valid CSS height (string).
   * The ChartCard adds the standard `-mx-2` bleed so the chart axis
   * labels don't get clipped by the card's left/right padding.
   */
  height?: number | string;
  /**
   * Treat the card as a `@container` parent so children can use
   * `@sm:`/`@md:` variants. Use for /insights cards where chart density
   * should respond to the card's own width (sidebar collapse), not the
   * viewport.
   */
  containerQuery?: boolean;
  /** Pass-through to the outer figure (styled as a Card). */
  className?: string;
  /**
   * Forwards to the chart-wrapping div so `<ExportButton targetRef={ref}>`
   * can render the chart-area to PNG. Wraps only the chart, not the
   * card chrome.
   */
  chartContainerRef?: React.Ref<HTMLDivElement>;
  /**
   * Slot below the chart for legend / footer / "view all →" link.
   * Renders inside the Card's padding (no negative margin).
   */
  footer?: React.ReactNode;
  /**
   * One plain sentence on what the chart shows now, built from the plotted
   * data ("Remaining points fell from 40 to 27 over 5 days; 6.6 points behind
   * the ideal line."). Shown under the title and used as the figure's
   * accessible description. Hides the plot from assistive tech: turn off the
   * chart's Recharts `accessibilityLayer`.
   */
  summary?: string;
  /**
   * The plotted series as rows. Adds a "View as table" toggle that swaps the
   * chart for a real table. Pass it on every render (rows may be empty, which
   * hides the toggle) so the chart isn't remounted when data arrives.
   */
  table?: ChartTable;
  /** A single Recharts component (BarChart, LineChart, AreaChart, …). */
  children: React.ReactNode;
}

/**
 * Standardised chart panel used in /insights and chart-heavy tools.
 *
 * Replaces the recurring 8-line pattern:
 *
 *   <Card>
 *     <CardHeader>
 *       <CardTitle className="text-sm flex items-center gap-2">
 *         <Icon className="w-4 h-4 text-accent" /> Title
 *       </CardTitle>
 *     </CardHeader>
 *     <CardContent>
 *       <div className="h-56 -mx-2">
 *         <ResponsiveContainer width="100%" height="100%">
 *           <BarChart>...</BarChart>
 *         </ResponsiveContainer>
 *       </div>
 *     </CardContent>
 *   </Card>
 *
 * With:
 *
 *   <ChartCard title="Daily activity" icon={Calendar} height={224}>
 *     <BarChart>...</BarChart>
 *   </ChartCard>
 *
 * The card is a `<figure>` named by its title. Add `summary` and `table` to
 * give the chart a text alternative (see useChartAlternative); without them it
 * renders as it always has.
 *
 * Mobile-first: the chart height comes from the prop verbatim — pair
 * with `useChartHeight()` if you want viewport-aware sizing. The `-mx-2`
 * negative margin always applies so axis labels reach the card edge.
 */
export function ChartCard({
  title,
  icon: Icon,
  badge,
  headerExtras,
  height = 224,
  containerQuery = false,
  className,
  chartContainerRef,
  footer,
  summary,
  table,
  children,
}: ChartCardProps) {
  const heightStyle = typeof height === "number" ? `${height}px` : height;
  const alt = useChartAlternative(summary, table);
  const hasActions = Boolean(headerExtras || alt.toggle);
  return (
    <figure
      aria-labelledby={alt.titleId}
      aria-describedby={alt.summaryId}
      className={cn(CARD_CLASS, containerQuery && "@container", className)}
    >
      <CardHeader className={cn((hasActions || summary) && "pb-2")}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0 flex-1">
            {Icon && <Icon className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />}
            <span id={alt.titleId} className="min-w-0 truncate">
              {title}
            </span>
            {badge &&
              (typeof badge === "string" ? (
                <Badge variant="outline" className="ml-2 font-sans text-xs">
                  {badge}
                </Badge>
              ) : (
                <span className="ml-2 font-sans">{badge}</span>
              ))}
          </CardTitle>
          {hasActions && (
            // With the toggle there can be three buttons: let them wrap
            // inside the card on a phone rather than run past its edge.
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 shrink-0",
                alt.toggle && "max-w-full"
              )}
            >
              {alt.toggle}
              {headerExtras}
            </div>
          )}
        </div>
        {summary && (
          <p id={alt.summaryId} className="text-xs text-sub">
            {summary}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <PlotWithTable
          table={table}
          tableId={alt.tableId}
          tableOpen={alt.tableOpen}
          caption={typeof title === "string" ? title : undefined}
        >
          <div
            ref={chartContainerRef}
            // -mx-1 on phones leaves the card padding intact (so axis ticks
            // don't visually clip into the card border); -mx-2 on sm+ where
            // the card has more horizontal room to bleed the chart edge.
            className={cn("-mx-1 sm:-mx-2", alt.tableOpen && PLOT_HIDDEN)}
            style={{ height: heightStyle }}
            aria-hidden={alt.hidePlot || undefined}
          >
            <ResponsiveContainer width="100%" height="100%">
              {/* recharts requires a single React element child */}
              {children as React.ReactElement}
            </ResponsiveContainer>
          </div>
        </PlotWithTable>
        {footer && <div className="mt-3">{footer}</div>}
      </CardContent>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/*  ChartFigure                                                                */
/* -------------------------------------------------------------------------- */

interface ChartFigureProps {
  /** The id of the visible heading that names the chart. */
  labelledBy?: string;
  /** The chart's name when no visible heading names it. */
  label?: string;
  /** One plain sentence on what the chart shows now (see ChartCard). */
  summary?: string;
  /** The plotted series as rows; adds the "View as table" toggle. */
  table?: ChartTable;
  /** Caption for the table when `table.caption` is unset. */
  caption?: string;
  /** Pass-through to the figure. */
  className?: string;
  /** Forwards to the plot wrapper (for ExportButton's PNG). */
  plotRef?: React.Ref<HTMLDivElement>;
  /** Pass-through to the plot wrapper. */
  plotClassName?: string;
  /** The chart; it sizes itself (its own ResponsiveContainer or fixed box). */
  children: React.ReactNode;
}

/**
 * ChartCard's figure, summary and "View as table" toggle without the card,
 * for a chart that sits inside a card of its own (a SectionCard, a tab). The
 * summary and toggle sit on one row above the plot.
 */
export function ChartFigure({
  labelledBy,
  label,
  summary,
  table,
  caption,
  className,
  plotRef,
  plotClassName,
  children,
}: ChartFigureProps) {
  const alt = useChartAlternative(summary, table);
  return (
    <figure
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={alt.summaryId}
      className={className}
    >
      {(summary || alt.toggle) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          {summary && (
            <p id={alt.summaryId} className="min-w-0 flex-1 text-xs text-sub">
              {summary}
            </p>
          )}
          {alt.toggle && <div className="ml-auto shrink-0">{alt.toggle}</div>}
        </div>
      )}
      <PlotWithTable
        table={table}
        tableId={alt.tableId}
        tableOpen={alt.tableOpen}
        caption={caption ?? label}
      >
        <div
          ref={plotRef}
          className={cn(plotClassName, alt.tableOpen && PLOT_HIDDEN)}
          aria-hidden={alt.hidePlot || undefined}
        >
          {children}
        </div>
      </PlotWithTable>
    </figure>
  );
}
