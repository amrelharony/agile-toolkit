"use client";

import { useState } from "react";

export type SortValues = Record<string, number | string | null>;

export interface FrozenSort {
  /** The value a column sorts this row by: as it was at the last sort. */
  valueOf: (key: string, column: string) => number | string | null;
  /** A value changed since the last sort, so a sorted table is out of date. */
  isStale: boolean;
  /** Sort by the values as they are now. */
  resort: () => void;
}

const same = (a: SortValues | undefined, b: SortValues) =>
  !!a && Object.keys(b).every((k) => a[k] === b[k]);

/**
 * Sort values that hold still while the backlog is edited, the
 * useStableOrder rule (hooks/use-stable-order) for a table that owns its
 * own sort.
 *
 * The items table is a DataTable, which keeps the sort the user picked (a
 * header, or "Sort by" on a phone) to itself; sorted by WSJF, a WSJF edit
 * would move the row out from under the user. Its columns sort by these
 * values instead: fixed when the table is first shown and whenever items
 * come or go, so an edit only marks them stale and the ResortChip offers
 * "Re-sort". Unsorted, the table keeps the decided order, which no score
 * edit changes.
 */
export function useFrozenSort<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  valuesOf: (item: T) => SortValues
): FrozenSort {
  const live = new Map(items.map((item) => [keyOf(item), valuesOf(item)]));
  // Membership, ignoring order: changes only when items come or go.
  const members = Array.from(live.keys()).sort().join("\u0000");
  const [frozen, setFrozen] = useState(() => ({ members, values: live }));
  let values = frozen.values;
  if (frozen.members !== members) {
    // Adjusting state during render (React's pattern for derived state):
    // an added or removed item takes the current values at once.
    values = live;
    setFrozen({ members, values: live });
  }
  const isStale = Array.from(live.entries()).some(([k, v]) => !same(values.get(k), v));
  return {
    valueOf: (key, column) => (values.get(key) ?? live.get(key))?.[column] ?? null,
    isStale,
    resort: () => setFrozen({ members, values: live }),
  };
}
