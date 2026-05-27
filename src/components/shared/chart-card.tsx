"use client";

import type { LucideIcon } from "lucide-react";
import { ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  /** Card title — short, descriptive. */
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
  /** Pass-through to the outer Card. */
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
  children,
}: ChartCardProps) {
  const heightStyle = typeof height === "number" ? `${height}px` : height;
  return (
    <Card className={cn(containerQuery && "@container", className)}>
      <CardHeader className={cn(headerExtras && "pb-2")}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0 flex-1">
            {Icon && <Icon className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{title}</span>
            {badge &&
              (typeof badge === "string" ? (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {badge}
                </Badge>
              ) : (
                <span className="ml-2">{badge}</span>
              ))}
          </CardTitle>
          {headerExtras && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">{headerExtras}</div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={chartContainerRef}
          // -mx-1 on phones leaves the card padding intact (so axis ticks
          // don't visually clip into the card border); -mx-2 on sm+ where
          // the card has more horizontal room to bleed the chart edge.
          className="-mx-1 sm:-mx-2"
          style={{ height: heightStyle }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {/* recharts requires a single React element child */}
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </CardContent>
    </Card>
  );
}
