"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  /** Heading text — short, descriptive. */
  title: React.ReactNode;
  /** Optional Lucide icon rendered to the left of the title. */
  icon?: LucideIcon;
  /**
   * Override the default icon colour (`text-accent`). Use a single
   * Tailwind colour utility, e.g. `text-accent-green` or `text-warning`.
   */
  iconClassName?: string;
  /**
   * Optional content rendered to the right of the title in a flex row
   * (e.g. ExportButton, AiPromptGenerator, Add button).
   */
  actions?: React.ReactNode;
  /**
   * Optional content rendered next to the title text (after it) but
   * before the actions cluster — e.g. a "— Total: 30 min" suffix or
   * a Badge.
   */
  titleSuffix?: React.ReactNode;
  /** Pass-through to the outer Card. */
  className?: string;
  /** Pass-through to the CardHeader. */
  headerClassName?: string;
  /** Pass-through to the CardContent. */
  contentClassName?: string;
  /**
   * When true the body is rendered without a CardContent wrapper —
   * for cases where the child needs to control its own padding.
   */
  bareContent?: boolean;
  /**
   * Title size token. Defaults to "base" matching the codebase
   * dominant pattern (`text-base font-display text-text`).
   */
  titleSize?: "sm" | "base" | "lg";
  children: React.ReactNode;
}

/**
 * Standardised content card used across most tools.
 *
 * Replaces the recurring 8-line pattern:
 *
 *   <Card className="bg-surface border-border">
 *     <CardHeader className="pb-3">
 *       <div className="flex items-center justify-between">
 *         <CardTitle className="text-base font-display text-text flex items-center gap-2">
 *           <Icon className="w-4 h-4 text-accent" /> Title
 *         </CardTitle>
 *         <Actions />
 *       </div>
 *     </CardHeader>
 *     <CardContent>...</CardContent>
 *   </Card>
 *
 * With:
 *
 *   <SectionCard title="Sprint Info" icon={Presentation} actions={<Button />}>
 *     ...
 *   </SectionCard>
 *
 * For chart-specific cards use `<ChartCard>` (auto-wraps in
 * `ResponsiveContainer` and adds the `-mx-2` axis-bleed). For plain
 * content cards (forms, lists, tables, KPI groups) use this.
 */
export function SectionCard({
  title,
  icon: Icon,
  iconClassName,
  actions,
  titleSuffix,
  className,
  headerClassName,
  contentClassName,
  bareContent = false,
  titleSize = "base",
  children,
}: SectionCardProps) {
  const titleSizeClass =
    titleSize === "sm" ? "text-sm" : titleSize === "lg" ? "text-lg" : "text-base";

  return (
    <Card className={className}>
      <CardHeader className={cn("pb-3", headerClassName)}>
        <div
          className={cn(
            // Wrap title + actions onto two lines on narrow viewports — the
            // previous single-row flex collapsed the title to "Sprint…" once
            // 3+ action buttons claimed the right edge. `gap-y-2` keeps the
            // two lines visually grouped.
            "flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          )}
        >
          <CardTitle
            className={cn(
              titleSizeClass,
              "font-display text-text flex items-center gap-2 min-w-0 flex-1"
            )}
          >
            {Icon && (
              <Icon
                className={cn("w-4 h-4 shrink-0", iconClassName ?? "text-accent")}
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 truncate">{title}</span>
            {titleSuffix && (
              <span className="text-sm text-sub font-normal ml-1 shrink-0">{titleSuffix}</span>
            )}
          </CardTitle>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
      </CardHeader>
      {bareContent ? children : <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  );
}
