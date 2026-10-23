"use client";

import { useState } from "react";

export interface StableOrder<T> {
  /** The items in the order on screen. */
  ordered: T[];
  /** True when a value changed since the last sort and the order on screen is out of date. */
  isStale: boolean;
  /** Sort again now. */
  resort: () => void;
}

/**
 * A ranked list that doesn't jump while someone is editing it.
 *
 * Risk Register, Weighted Decision and others rendered the list sorted by
 * score, so changing a score moved the row out from under the cursor
 * mid-edit. Here the order is fixed when the list is first shown and
 * whenever items are added or removed; editing a value only marks the
 * order stale (`isStale`), and the tool shows a "Re-sort" chip
 * (`ResortChip`) that calls `resort`.
 *
 * `compare` may be a new function every render; it's only called to sort.
 */
export function useStableOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  compare: (a: T, b: T) => number
): StableOrder<T> {
  const sortedKeys = [...items].sort(compare).map(keyOf);
  // Membership, ignoring order: changes only when items come or go.
  const members = [...sortedKeys].sort().join("\u0000");

  const [pinned, setPinned] = useState(() => ({ members, keys: sortedKeys }));
  let keys = pinned.keys;
  if (pinned.members !== members) {
    // Adjusting state during render (React's pattern for derived state):
    // an added or removed item re-sorts at once, without an extra paint.
    keys = sortedKeys;
    setPinned({ members, keys: sortedKeys });
  }

  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const ordered = keys.flatMap((k) => {
    const item = byKey.get(k);
    return item === undefined ? [] : [item];
  });
  const isStale = keys.some((k, i) => k !== sortedKeys[i]);

  return {
    ordered,
    isStale,
    resort: () => setPinned({ members, keys: sortedKeys }),
  };
}
