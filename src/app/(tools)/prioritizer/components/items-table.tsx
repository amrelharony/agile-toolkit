"use client";

/**
 * The backlog, edited in place: a DataTable (sortable headers, one card
 * per item on a phone, so nothing scrolls sideways at 375 px) in the
 * decided order, ranked items first.
 *
 * Each embedded method (MoSCoW, WSJF, RICE, Value/Effort) has a cell that
 * shows the engine's result and opens the method's own inputs in place
 * (./score-editor). The item owns those inputs: a save writes the item, and
 * every method tool's row linked to it reads the change through. A method
 * nobody scored reads "Not scored" (or "Not sorted yet", "Not placed yet"),
 * never 0. Sorted by a column, the rows hold still while they are edited
 * (useFrozenSort + ResortChip, shown only while a column is sorted and
 * that column's values changed). Delete has Undo, and focus moves to the
 * next row's Delete, so the keyboard stays in the table.
 */

import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ResortChip } from "@/components/shared/resort-chip";
import { IconButton } from "@/components/ui/icon-button";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import {
  evaluateItemIn,
  method,
  type MethodScore,
  type Values,
} from "@/lib/prioritization/methods";
import { decidedOrder } from "@/lib/prioritization/rank";
import { rememberedPeriod, type HubMethodId } from "../hub-form";
import { HUB_EDITED, itemName } from "../method-text";
import { rankOf } from "../order";
import { useFrozenSort, useTableSort, type SortValues } from "../use-frozen-sort";
import { useTableName } from "../use-table-name";
import { MethodCell } from "./score-editor";
import { NameCell } from "./name-cell";

type View = "table" | "card";

/** The table's columns, in order (useTableSort reads the sorted one by its place). */
const COLUMN_KEYS: readonly string[] = ["rank", "name", ...HUB_EDITED, "actions"];

/** What the ResortChip says changed, by the sorted column. */
const changedText = (column: string | undefined) =>
  column === "rank" ? "Ranks" : column === "name" ? "Names" : "Scores";

interface Row {
  item: BacklogItem;
  results: Record<HubMethodId, MethodScore>;
}

const sortValuesOf = (r: Row): SortValues => {
  const rank = rankOf(r.item);
  const out: SortValues = {
    // Negated, so "high to low" (the first click) puts rank 1 first.
    rank: rank === undefined ? null : -rank,
    name: r.item.name.trim().toLowerCase(),
  };
  for (const id of HUB_EDITED) out[id] = r.results[id].sortKey;
  return out;
};

export function ItemsTable({
  items,
  onRename,
  onDescribe,
  onSaveScores,
  onRemove,
  focusId,
  onFocused,
  emptyState,
}: {
  items: readonly BacklogItem[];
  onRename: (id: string, name: string) => void;
  onDescribe: (id: string, description: string | undefined) => void;
  onSaveScores: (id: string, methodId: HubMethodId, values: Values) => void;
  onRemove: (id: string) => void;
  /** An item just added: its first score button takes focus once it's on screen. */
  focusId?: string | null;
  onFocused?: () => void;
  /** Shown instead of the table while the backlog is empty. */
  emptyState: ReactNode;
}) {
  const rows = useMemo<Row[]>(
    () =>
      decidedOrder(items).map((item) => ({
        item,
        results: Object.fromEntries(
          HUB_EDITED.map((id) => [id, evaluateItemIn(item, [], id)])
        ) as Record<HubMethodId, MethodScore>,
      })),
    [items]
  );
  const period = useMemo(() => rememberedPeriod(items), [items]);
  const tableBox = useRef<HTMLDivElement>(null);
  const tableSort = useTableSort(tableBox, COLUMN_KEYS);
  const frozen = useFrozenSort(rows, (r) => r.item.id, sortValuesOf, tableSort.sort);
  useTableName(tableBox, "Backlog items");

  // After a delete: the next row's Delete (or the one above), as the rows
  // read on screen; with none left, the table's own box.
  const box = useRef<HTMLDivElement>(null);
  const focusAfterDelete = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = focusAfterDelete.current;
    if (!el) return;
    focusAfterDelete.current = null;
    (el.isConnected ? el : box.current)?.focus();
  });
  const remove = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    const row = e.currentTarget.closest("tr, li");
    const next = row?.nextElementSibling ?? row?.previousElementSibling;
    focusAfterDelete.current =
      next?.querySelector<HTMLElement>("[data-delete-item]") ?? box.current;
    onRemove(id);
  };

  // The score buttons by view and item: the desktop table and the phone
  // cards are both in the DOM, and focus goes to the one on screen.
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const triggerRef = (view: View, id: string) => (el: HTMLButtonElement | null) => {
    const key = `${view}:${id}`;
    if (el) triggers.current.set(key, el);
    else triggers.current.delete(key);
  };
  useEffect(() => {
    if (!focusId) return;
    const candidates = (["table", "card"] as View[])
      .map((v) => triggers.current.get(`${v}:${focusId}`))
      .filter((el): el is HTMLButtonElement => !!el);
    if (candidates.length === 0) return;
    const shown = candidates.find((el) => el.getClientRects().length > 0) ?? candidates[0];
    shown.focus();
    onFocused?.();
  }, [focusId, rows, onFocused]);

  const cellFor = (r: Row, id: HubMethodId, view: View) => (
    <MethodCell
      item={r.item}
      methodId={id}
      result={r.results[id]}
      period={period}
      onSave={(values) => onSaveScores(r.item.id, id, values)}
      triggerRef={id === HUB_EDITED[0] ? triggerRef(view, r.item.id) : undefined}
    />
  );

  const removeButton = (r: Row) => (
    <IconButton
      label={`Delete ${itemName(r.item.name)}`}
      icon={<Trash2 className="h-4 w-4" />}
      className="text-sub hover:text-danger"
      data-delete-item=""
      onClick={(e) => remove(e, r.item.id)}
    />
  );

  const nameCell = (r: Row) => (
    <NameCell
      name={r.item.name}
      description={r.item.description}
      onRename={(name) => onRename(r.item.id, name)}
      onDescribe={(d) => onDescribe(r.item.id, d)}
    />
  );

  const orderText = (r: Row) => {
    const rank = rankOf(r.item);
    return rank === undefined ? (
      <span className="text-xs text-sub">Not ordered yet</span>
    ) : (
      <span className="font-data text-sm text-text">
        <span className="sr-only">Rank </span>
        {rank}
      </span>
    );
  };

  const columns: DataTableColumn<Row>[] = [
    {
      key: "rank",
      header: "Order",
      width: "6rem",
      cell: orderText,
      sortValue: (r) => frozen.valueOf(r.item.id, "rank"),
    },
    {
      key: "name",
      header: "Item",
      primary: true,
      cell: nameCell,
      sortValue: (r) => frozen.valueOf(r.item.id, "name"),
    },
    ...HUB_EDITED.map(
      (id): DataTableColumn<Row> => ({
        key: id,
        header: method(id).label,
        cell: (r) => cellFor(r, id, "table"),
        sortValue: (r) => frozen.valueOf(r.item.id, id),
      })
    ),
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      sortLabel: "Actions",
      width: "3rem",
      cell: removeButton,
    },
  ];

  return (
    // Focusable only from code: where a delete leaves focus when no row is left.
    <div ref={box} tabIndex={-1} className="rounded focus:outline-none">
      {rows.length === 0 ? (
        emptyState
      ) : (
        <>
          <ResortChip
            isStale={frozen.isStale}
            onResort={frozen.resort}
            what={changedText(tableSort.sort?.key)}
          />
          {/* A click or a change inside may be a header or "Sort by": the sort is read again. */}
          <div
            ref={tableBox}
            onClickCapture={tableSort.onClickCapture}
            onChangeCapture={tableSort.onChangeCapture}
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.item.id}
              renderCard={(r) => (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    {orderText(r)}
                    {removeButton(r)}
                  </div>
                  {nameCell(r)}
                  <dl className="grid grid-cols-1 gap-1">
                    {HUB_EDITED.map((id) => (
                      <div key={id} className="flex items-center justify-between gap-2">
                        <dt className="text-xs text-sub">{method(id).label}</dt>
                        <dd className="min-w-0 text-right">{cellFor(r, id, "card")}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
