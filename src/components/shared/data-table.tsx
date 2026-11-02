"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";
export interface DataTableSort {
  key: string;
  dir: SortDirection;
}

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
  /**
   * Makes the column sortable: the value to sort by. Blank values
   * (null, undefined, NaN, "") always sort last, whichever the direction.
   */
  sortValue?: (row: Row) => number | string | null | undefined;
  /** Plain-text name for the sort control when `header` isn't a string. */
  sortLabel?: string;
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
  /** The sort before the user picks one; rows keep their given order without it. */
  defaultSort?: DataTableSort;
  /**
   * The sort, controlled (null: rows in their given order). A header click
   * or a "Sort by" pick calls onSortChange instead of changing it here, so
   * the page knows the sort (e.g. to offer "Re-sort" only while sorted).
   * Left undefined, the table keeps its own sort (from defaultSort).
   */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  /**
   * The table's accessible name: a visually hidden <caption>, and the
   * phone cards' list label. Without one a screen reader's list of tables
   * reads "table, table".
   */
  caption?: string;
}

type SortValue = number | string | null | undefined;

const isBlankSortValue = (v: SortValue) =>
  v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

/** Rows sorted by one column; stable, with blanks last. Exported for tests. */
export function sortRows<Row>(
  rows: readonly Row[],
  sortValue: (row: Row) => SortValue,
  dir: SortDirection
): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a);
    const vb = sortValue(b);
    const ba = isBlankSortValue(va);
    const bb = isBlankSortValue(vb);
    if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sign;
  });
}

const ariaSort = (active: boolean, dir: SortDirection) =>
  active ? (dir === "asc" ? "ascending" : "descending") : undefined;

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
  defaultSort,
  sort: controlledSort,
  onSortChange,
  caption,
}: DataTableProps<Row>) {
  const [ownSort, setOwnSort] = useState<DataTableSort | undefined>(defaultSort);
  const controlled = controlledSort !== undefined;
  const sort = controlled ? (controlledSort ?? undefined) : ownSort;
  const changeSort = (next: DataTableSort | undefined) => {
    if (!controlled) setOwnSort(next);
    onSortChange?.(next ?? null);
  };
  const sortSelectId = useId();
  const sortable = columns.filter((c) => c.sortValue);
  const sortColumn = sort && columns.find((c) => c.key === sort.key && c.sortValue);
  const shown =
    sort && sortColumn?.sortValue ? sortRows(rows, sortColumn.sortValue, sort.dir) : rows;
  const toggleSort = (key: string) =>
    changeSort(
      sort?.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }
    );
  const nameOf = (col: DataTableColumn<Row>) =>
    col.sortLabel ?? (typeof col.header === "string" ? col.header : col.key);

  if (rows.length === 0 && emptyState !== undefined) {
    return <div className={cn("py-8 text-center text-sm text-sub", className)}>{emptyState}</div>;
  }

  return (
    <div className={className}>
      {/* Desktop / tablet: proper table */}
      <div className="hidden md:block">
        {/* relative: a containing block, so sr-only text in cells can't widen the page. */}
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-sub">
                {columns.map((col) => {
                  const active = sort?.key === col.key;
                  const Icon =
                    !active || !sort ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={col.key}
                      aria-sort={col.sortValue && sort ? ariaSort(active, sort.dir) : undefined}
                      className={cn(
                        "px-3 py-2 font-medium",
                        col.hiddenBelow ? HIDDEN_CLASS[col.hiddenBelow] : undefined,
                        col.align ? ALIGN_CLASS[col.align] : "text-left"
                      )}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            active && "text-text"
                          )}
                        >
                          {col.header}
                          <Icon className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">, sort</span>
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                // A clickable row stays a row: role="button" on a <tr> would
                // strip the table semantics (cells lose their headers). The
                // row is focusable and Enter / Space activate it instead.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <tr
                  key={rowKey(row, i)}
                  className={cn(
                    "border-b border-rule last:border-0",
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

      {/* Mobile: stacked cards, with the sort as a select (no headers to click) */}
      {sortable.length > 0 && (
        <div className="mb-2 flex items-center gap-2 md:hidden">
          <label htmlFor={sortSelectId} className="text-xs text-sub">
            Sort by
          </label>
          <select
            id={sortSelectId}
            value={sort ? `${sort.key}:${sort.dir}` : ""}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              changeSort(key ? { key, dir: dir as SortDirection } : undefined);
            }}
            className="h-11 rounded border border-border bg-surface-deep px-2 text-base text-text focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {!defaultSort && <option value="">As listed</option>}
            {sortable.flatMap((col) => [
              <option key={`${col.key}:desc`} value={`${col.key}:desc`}>
                {nameOf(col)}, high to low
              </option>,
              <option key={`${col.key}:asc`} value={`${col.key}:asc`}>
                {nameOf(col)}, low to high
              </option>,
            ])}
          </select>
        </div>
      )}
      <ul className="md:hidden space-y-2" aria-label={caption}>
        {shown.map((row, i) => {
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
