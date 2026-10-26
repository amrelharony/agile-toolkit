"use client";

import { useState } from "react";

export type SortValues = Record<string, number | string | null>;

/** The column a DataTable is sorted by, and which way. */
export interface TableSort {
  key: string;
  dir: "asc" | "desc";
}

export interface FrozenSort {
  /** The value a column sorts this row by: as it was at the last sort. */
  valueOf: (key: string, column: string) => number | string | null;
  /** The sorted column's values changed since the last sort, so the rows on screen are out of date. */
  isStale: boolean;
  /** Sort by the values as they are now. */
  resort: () => void;
}

const sortText = (sort: TableSort | null) => (sort ? `${sort.key}:${sort.dir}` : "");

/**
 * Sort values that hold still while the backlog is edited, the
 * useStableOrder rule (hooks/use-stable-order) for a table sorted by a
 * column the user picks.
 *
 * The items table is a DataTable sorted by the user (a header, or "Sort
 * by" on a phone); sorted by WSJF, a WSJF edit would move the row out from
 * under the user. Its columns sort by these values instead: fixed when a
 * sort is picked (a header click is a request to sort by the values as
 * they are now) and whenever items come or go, so an edit to the sorted
 * column only marks it stale and the ResortChip offers "Re-sort". `sort`
 * is the table's sort (DataTable's controlled `sort`); unsorted, the table
 * keeps the decided order, nothing is held and nothing is stale, so an
 * edit on the default view announces nothing.
 */
export function useFrozenSort<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  valuesOf: (item: T) => SortValues,
  sort: TableSort | null
): FrozenSort {
  const live = new Map(items.map((item) => [keyOf(item), valuesOf(item)]));
  // Membership, ignoring order (changes only when items come or go), and the sort.
  const members = Array.from(live.keys()).sort().join("\u0000");
  const sig = `${sortText(sort)}\u0001${members}`;
  const [frozen, setFrozen] = useState(() => ({ sig, values: live }));
  let values = frozen.values;
  if (frozen.sig !== sig) {
    // Adjusting state during render (React's pattern for derived state): a
    // new sort, or an added or removed item, takes the current values at once.
    values = live;
    setFrozen({ sig, values: live });
  }
  if (!sort) values = live;
  const column = sort?.key;
  const isStale =
    column !== undefined &&
    Array.from(live.entries()).some(([k, v]) => (values.get(k)?.[column] ?? null) !== v[column]);
  return {
    valueOf: (key, col) => (values.get(key) ?? live.get(key))?.[col] ?? null,
    isStale,
    resort: () => setFrozen({ sig, values: live }),
  };
}
