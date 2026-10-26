"use client";

import {
  useEffect,
  useReducer,
  useState,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";

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
 * useStableOrder rule (hooks/use-stable-order) for a table that owns its
 * own sort.
 *
 * The items table is a DataTable, which keeps the sort the user picked (a
 * header, or "Sort by" on a phone) to itself; sorted by WSJF, a WSJF edit
 * would move the row out from under the user. Its columns sort by these
 * values instead: fixed when a sort is picked (a header click is a request
 * to sort by the values as they are now) and whenever items come or go, so
 * an edit to the sorted column only marks it stale and the ResortChip
 * offers "Re-sort". `sort` is the table's sort (useTableSort); unsorted,
 * the table keeps the decided order, nothing is held and nothing is stale,
 * so an edit on the default view announces nothing.
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

/**
 * The sort a DataTable shows, read from its headers' aria-sort: DataTable
 * keeps the sort it was given (a header click, or "Sort by" on a phone) to
 * itself, and aria-sort on the sorted column's header is how it says which
 * column that is. (DataTable rendering every header, at any width, is what
 * makes this work on a phone too.) `keys` are its columns' keys, in order.
 *
 * `ref` is an element around the DataTable; put the two handlers on it: a
 * click in its header row or a change of a select (the phone's "Sort by")
 * re-reads the sort once DataTable has rendered it.
 */
export function useTableSort(
  ref: RefObject<HTMLElement>,
  keys: readonly string[]
): {
  sort: TableSort | null;
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
  onChangeCapture: (e: FormEvent<HTMLElement>) => void;
} {
  const [sort, setSort] = useState<TableSort | null>(null);
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  const keyText = keys.join("\u0000");
  // After every render, deliberately: DataTable's sort is its own state, so
  // our render (a recheck, or the table coming back after its empty state)
  // is the only cue that it may have changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const th = ref.current?.querySelector("thead th[aria-sort]");
    const index = th?.parentElement ? Array.from(th.parentElement.children).indexOf(th) : -1;
    const key = index >= 0 ? keyText.split("\u0000")[index] : undefined;
    const next: TableSort | null = key
      ? { key, dir: th?.getAttribute("aria-sort") === "ascending" ? "asc" : "desc" }
      : null;
    // The same sort keeps the same state, so this settles at once.
    setSort((cur) => (sortText(cur) === sortText(next) ? cur : next));
  });
  return {
    sort,
    onClickCapture: (e) => {
      if (e.target instanceof Element && e.target.closest("thead")) recheck();
    },
    onChangeCapture: (e) => {
      if (e.target instanceof HTMLSelectElement) recheck();
    },
  };
}
