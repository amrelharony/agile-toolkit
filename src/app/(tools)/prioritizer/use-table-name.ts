"use client";

import { useEffect, type RefObject } from "react";

/**
 * An accessible name for the table a DataTable renders inside `ref`'s
 * element. DataTable renders no <caption> and takes no aria-label
 * (components/shared/data-table), so a screen reader's list of tables would
 * read "table, table, table"; the old All methods table had a caption. Set
 * after every render, so a table DataTable puts back (after its empty
 * state) is named too.
 */
export function useTableName(ref: RefObject<HTMLElement>, name: string): void {
  useEffect(() => {
    const table = ref.current?.querySelector("table");
    if (table && table.getAttribute("aria-label") !== name) table.setAttribute("aria-label", name);
  });
}
