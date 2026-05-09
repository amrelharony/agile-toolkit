"use client";

import { cn } from "@/lib/utils";

type ColCount = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Either a single number (e.g. `cols={4}` — KpiGrid picks the mobile-first
 * progression for you) or an explicit tuple `[xs, sm, md]` /
 * `[xs, sm, md, lg]` for fine-grained control.
 */
type ColsConfig =
  | ColCount
  | [ColCount, ColCount, ColCount]
  | [ColCount, ColCount, ColCount, ColCount];

interface KpiGridProps {
  /** Number of KPI tiles or an explicit responsive tuple. Default: 4. */
  cols?: ColsConfig;
  /** Tile gap. `md` = `gap-3` (12 px), `lg` = `gap-4` (16 px). Default: md. */
  gap?: "sm" | "md" | "lg";
  /** Margin below the grid. `lg` = `mb-6` (24 px). Default: lg. */
  marginBottom?: "none" | "sm" | "md" | "lg";
  /** Pass-through for any extra utilities the call site needs. */
  className?: string;
  /** KPI tiles — typically `<StatCard variant="compact">` instances. */
  children: React.ReactNode;
}

/**
 * Picked progressions for the simple-`cols=N` case. Each row is the
 * mobile-first `[xs, sm, md]` triple. The choices below come from
 * inspecting every KPI grid in the toolkit:
 *
 *   1 → never used (a single tile is just a card, not a grid)
 *   2 → 2 tiles always look fine in 2 cols even on phones
 *   3 → 1 col on phones (each tile gets the full width and breathes),
 *       2 on small tablets, 3 on md+. Stops the awkward 1.5-tile-wide
 *       look that a 3-col grid produces on a 380 px viewport.
 *   4 → 2 on phones (matches kanban / homepage / scrum-of-scrums), 4 on md+.
 *   5/6 → 2 on phones, 3 on tablets, full count on md+.
 */
const RESPONSIVE_DEFAULTS: Record<ColCount, [ColCount, ColCount, ColCount]> = {
  1: [1, 1, 1],
  2: [2, 2, 2],
  3: [1, 2, 3],
  4: [2, 2, 4],
  5: [2, 3, 5],
  6: [2, 3, 6],
};

// Class lookup tables — string literals so Tailwind's content-scan picks
// every reachable utility at build time. Mirrors the FormGrid pattern.
const COLS: Record<ColCount, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};
const SM_COLS: Record<ColCount, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
};
const MD_COLS: Record<ColCount, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
};
const LG_COLS: Record<ColCount, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

const GAP: Record<NonNullable<KpiGridProps["gap"]>, string> = {
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
};

const MB: Record<NonNullable<KpiGridProps["marginBottom"]>, string> = {
  none: "",
  sm: "mb-3",
  md: "mb-4",
  lg: "mb-6",
};

/**
 * Bundles the responsive grid + standard KPI-row spacing that every tool
 * was previously hand-rolling.
 *
 * Replaces this:
 *
 *   <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
 *     <StatCard variant="compact" .../>
 *     <StatCard variant="compact" .../>
 *     <StatCard variant="compact" .../>
 *   </div>
 *
 * With:
 *
 *   <KpiGrid cols={3}>
 *     <StatCard variant="compact" .../>
 *     <StatCard variant="compact" .../>
 *     <StatCard variant="compact" .../>
 *   </KpiGrid>
 *
 * The simple `cols={N}` form picks a sensible mobile-first progression
 * (see `RESPONSIVE_DEFAULTS` above). For full control, pass a tuple:
 * `cols={[1, 2, 4]}` → 1 column on phones, 2 on tablets, 4 on desktop.
 *
 * Children are typed as `ReactNode`, not specifically StatCards, so a
 * tool can mix in a non-KPI cell (e.g. a danger-state alert that uses a
 * different card style) without fighting the API.
 */
export function KpiGrid({
  cols = 4,
  gap = "md",
  marginBottom = "lg",
  className,
  children,
}: KpiGridProps) {
  const tuple = Array.isArray(cols) ? cols : RESPONSIVE_DEFAULTS[cols];
  const [xsCols, smCols, mdCols, lgCols] = tuple;
  return (
    <div
      className={cn(
        "grid",
        COLS[xsCols],
        smCols && SM_COLS[smCols],
        mdCols && MD_COLS[mdCols],
        lgCols && LG_COLS[lgCols],
        GAP[gap],
        MB[marginBottom],
        className
      )}
    >
      {children}
    </div>
  );
}
