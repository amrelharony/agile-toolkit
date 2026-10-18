"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** Hide this column at or below this breakpoint when rendered as a table. */
  hiddenBelow?: "sm" | "md" | "lg";
  /** Horizontal alignment for the table cell (card view ignores this). */
  align?: "left" | "center" | "right";
  /** Optional CSS width for the table column. */
  width?: string;
  /** For card view — treated as the bold title row when `primary: true`. */
  primary?: boolean;
  /** Hide this column entirely in card view. */
  cardHidden?: boolean;
}

interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** Custom card renderer for max-md. Falls back to a stacked definition list. */
  renderCard?: (row: Row, index: number) => ReactNode;
  /** Shown when `rows.length === 0`. */
  emptyState?: ReactNode;
  className?: string;
  /**
   * Row-level onClick. Table rows become focusable (Enter / Space activate)
   * and keep their row semantics; mobile cards render as a button inside
   * the list item.
   */
  onRowClick?: (row: Row, index: number) => void;
}

const HIDDEN_CLASS: Record<NonNullable<DataTableColumn<unknown>["hiddenBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const ALIGN_CLASS: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * Responsive data table.  On `md+` renders a semantic <table>; on `max-md`
 * stacks rows as cards so no horizontal scroll is needed.  Mobile users get
 * readable, tap-friendly rows without a bespoke card layout per tool.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  renderCard,
  emptyState,
  className,
  onRowClick,
}: DataTableProps<Row>) {
  if (rows.length === 0 && emptyState !== undefined) {
    return <div className={cn("py-8 text-center text-sm text-sub", className)}>{emptyState}</div>;
  }

  return (
    <div className={className}>
      {/* Desktop / tablet: proper table */}
      <div className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-sub">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-3 py-2 font-medium",
                      col.hiddenBelow ? HIDDEN_CLASS[col.hiddenBelow] : undefined,
                      col.align ? ALIGN_CLASS[col.align] : "text-left"
                    )}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                // A clickable row stays a row: role="button" on a <tr> would
                // strip the table semantics (cells lose their headers). The
                // row is focusable and Enter / Space activate it instead.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <tr
                  key={rowKey(row, i)}
                  className={cn(
                    "border-b border-border last:border-0",
                    onRowClick && "cursor-pointer hover:bg-surface-hover active-press"
                  )}
                  onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          // Ignore keys bubbling from controls inside a cell.
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row, i);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2.5",
                        col.hiddenBelow ? HIDDEN_CLASS[col.hiddenBelow] : undefined,
                        col.align ? ALIGN_CLASS[col.align] : "text-left"
                      )}
                    >
                      {col.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="md:hidden space-y-2">
        {rows.map((row, i) => {
          const cardClass = "rounded-lg border border-border bg-card p-3";
          const body = renderCard ? (
            renderCard(row, i)
          ) : (
            <dl className="grid grid-cols-1 gap-1.5">
              {columns
                .filter((c) => !c.cardHidden)
                .map((col) => (
                  <Fragment key={col.key}>
                    {col.primary ? (
                      // A <dd> needs its <dt>; the title row's term is
                      // visually implied, so it's screen-reader only.
                      <div>
                        <dt className="sr-only">{col.header}</dt>
                        <dd className="text-sm font-semibold text-text">{col.cell(row, i)}</dd>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3 text-xs">
                        <dt className="text-sub">{col.header}</dt>
                        <dd className="text-right text-text/90">{col.cell(row, i)}</dd>
                      </div>
                    )}
                  </Fragment>
                ))}
            </dl>
          );
          return (
            <li key={rowKey(row, i)} className={onRowClick ? undefined : cardClass}>
              {onRowClick ? (
                // The button sits inside the <li> so the list keeps its
                // item semantics (role="button" on the <li> replaced them).
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(cardClass, "cursor-pointer active-press")}
                  onClick={() => onRowClick(row, i)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(row, i);
                    }
                  }}
                >
                  {body}
                </div>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
