"use client";

import { cn } from "@/lib/utils";

interface FormGridProps {
  /** Form fields. Each child becomes one grid cell. */
  children: React.ReactNode;
  /**
   * Number of columns at each breakpoint. Mobile-first — the array index
   * maps to xs / sm / md / lg widths. Defaults to a sensible 1 → 2 → 3
   * progression that works for almost every settings/config form in the app.
   *
   * Custom example for a 4-column form on `lg`:
   *   <FormGrid cols={[1, 2, 2, 4]}> ... </FormGrid>
   */
  cols?: [xs: number, sm: number, md: number, lg?: number];
  /** Gap between fields. Defaults to `gap-4` (16 px). */
  gap?: "sm" | "md" | "lg";
  className?: string;
}

const COLS_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

const SM_COLS_CLASS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
};

const MD_COLS_CLASS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
};

const LG_COLS_CLASS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

const GAP_CLASS = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
} as const;

/**
 * Drop-in responsive form grid.
 *
 * Replaces the dozen+ ad-hoc `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3`
 * patterns scattered across burndown/burnup/capacity/raci/dod-builder/etc.
 *
 * Why a primitive: the existing implementations are inconsistent — some
 * skip the `md:` step (jumps from 1 → 3), some use `gap-3`, some `gap-4`,
 * some include `mb-6` and some don't. Standardising under one component
 * means the app's forms breathe the same way at every breakpoint.
 *
 * The class lookup tables make the dynamic class strings safelist-friendly
 * for Tailwind's content-scan: every reachable class is a string literal
 * inside this file, so the JIT compiler picks them up at build time.
 */
export function FormGrid({
  children,
  cols = [1, 2, 3],
  gap = "md",
  className,
}: FormGridProps) {
  const [xsCols, smCols, mdCols, lgCols] = cols;
  return (
    <div
      className={cn(
        "grid",
        COLS_CLASS[xsCols] ?? "grid-cols-1",
        smCols && SM_COLS_CLASS[smCols],
        mdCols && MD_COLS_CLASS[mdCols],
        lgCols && LG_COLS_CLASS[lgCols],
        GAP_CLASS[gap],
        className
      )}
    >
      {children}
    </div>
  );
}
