"use client";

/**
 * Every finished item from the sources picked, in order of completion: a
 * story or card from the boards (read-only here, it lives on the board) or
 * an item typed by hand (edited in place, deleted with Undo from the page).
 * A card per item on a phone, so nothing scrolls sideways. The order is
 * fixed while dates are edited, with a "Re-sort" chip once it's stale.
 */

import { useEffect, useId, useState } from "react";
import Link from "@/components/motion/transition-link";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { BlurInput } from "@/components/shared/blur-fields";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ResortChip } from "@/components/shared/resort-chip";
import { useStableOrder } from "@/hooks/use-stable-order";
import type { CycleSource, WorkItem } from "../types";
import { SOURCE_LABEL, typedDays } from "../helpers";
import { ITEM_NAME_MAX, editDateError } from "../form";

/** A row of the table: a finished board item, or a typed item (complete or not). */
export interface ItemRow {
  key: string;
  source: CycleSource;
  title: string;
  startedOn: string;
  doneOn: string;
  days: number | null;
  /** The typed item, for editing; absent for a board item. */
  typed?: WorkItem;
}

/** A typed item's date, edited in place: committed on blur, refused with a message when wrong. */
function DateCell({
  item,
  field,
  today,
  onCommit,
}: {
  item: WorkItem;
  field: "startDate" | "endDate";
  today: string;
  onCommit: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(item[field]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(item[field]);
    setError(null);
  }, [item, field]);
  const commit = () => {
    if (draft === item[field]) {
      setError(null);
      return;
    }
    const err = editDateError(item, field, draft, today);
    setError(err);
    if (!err) onCommit(draft);
  };
  const what = field === "startDate" ? "Start" : "Finish";
  return (
    <div>
      <Input
        type="date"
        max={today}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(item[field]);
            setError(null);
          }
        }}
        aria-label={`${what} of ${item.name || "item"}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-8 w-40 input-toolkit"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 max-w-[12rem] text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function TitleCell({
  row,
  onRename,
}: {
  row: ItemRow;
  onRename: (item: WorkItem, name: string) => void;
}) {
  // Remounts the field when an emptied name is put back, so it shows the saved one.
  const [nameKey, setNameKey] = useState(0);
  if (!row.typed) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text">{row.title}</span>
        <Badge variant="outline" className="border-border text-xs text-sub">
          {SOURCE_LABEL[row.source]}
        </Badge>
      </span>
    );
  }
  const item = row.typed;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <BlurInput
        key={nameKey}
        value={item.name}
        maxLength={ITEM_NAME_MAX}
        onCommit={(v) => (v.trim() ? onRename(item, v.trim()) : setNameKey((k) => k + 1))}
        aria-label={`Name of ${item.name.trim() || "item"}`}
        className="h-8 min-w-[10rem] flex-1 input-toolkit"
      />
      <Badge variant="outline" className="border-border text-xs text-sub">
        Typed
      </Badge>
    </span>
  );
}

export function WorkItemsTable({
  rows,
  today,
  onRename,
  onDate,
  onRemove,
}: {
  rows: ItemRow[];
  today: string;
  onRename: (item: WorkItem, name: string) => void;
  onDate: (item: WorkItem, field: "startDate" | "endDate", value: string) => void;
  onRemove: (item: WorkItem) => void;
}) {
  const { ordered, isStale, resort } = useStableOrder(
    rows,
    (r) => r.key,
    // Completion order; typed items still missing a date go last.
    (a, b) =>
      a.days === null || b.days === null
        ? Number(a.days === null) - Number(b.days === null)
        : a.doneOn.localeCompare(b.doneOn)
  );
  const columns: DataTableColumn<ItemRow>[] = [
    {
      key: "title",
      header: "Item",
      primary: true,
      cell: (r) => <TitleCell row={r} onRename={onRename} />,
    },
    {
      key: "start",
      header: "Started",
      cell: (r) =>
        r.typed ? (
          <DateCell
            item={r.typed}
            field="startDate"
            today={today}
            onCommit={(v) => onDate(r.typed!, "startDate", v)}
          />
        ) : (
          <span className="font-data text-sm">{r.startedOn}</span>
        ),
    },
    {
      key: "end",
      header: "Finished",
      cell: (r) =>
        r.typed ? (
          <DateCell
            item={r.typed}
            field="endDate"
            today={today}
            onCommit={(v) => onDate(r.typed!, "endDate", v)}
          />
        ) : (
          <span className="font-data text-sm">{r.doneOn}</span>
        ),
    },
    {
      key: "days",
      header: "Cycle time",
      align: "center",
      cell: (r) =>
        r.days !== null ? (
          <span className="font-data font-semibold text-accent">{r.days}d</span>
        ) : (
          <span className="text-xs text-sub">—</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      sortLabel: "Actions",
      align: "right",
      cell: (r) =>
        r.typed ? (
          <IconButton
            label={`Delete ${r.typed.name || "item"}`}
            icon={<Trash2 aria-hidden="true" />}
            onClick={() => onRemove(r.typed!)}
            className="text-sub hover:text-danger"
            // Lets the page put focus on the next item's Delete after this one goes.
            data-item-delete={r.typed.id}
          />
        ) : (
          <Link href="/kanban" className="text-xs font-medium text-accent hover:underline">
            On the board
          </Link>
        ),
    },
  ];
  return (
    <>
      <ResortChip isStale={isStale} onResort={resort} what="Dates" />
      <DataTable columns={columns} rows={ordered} rowKey={(r) => r.key} />
    </>
  );
}

/** The typed items as rows, each with its cycle time (null while a date is missing). */
export function typedItemRows(items: readonly WorkItem[]): ItemRow[] {
  return items.map((i) => ({
    key: `typed:${i.id}`,
    source: "typed",
    title: i.name,
    startedOn: i.startDate,
    doneOn: i.endDate,
    days: typedDays(i),
    typed: i,
  }));
}
