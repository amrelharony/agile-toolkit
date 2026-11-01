"use client";

/**
 * The typed snapshots, edited in place: one row per date (a card per date
 * on a phone, so nothing scrolls sideways), a count per column, a note and
 * Delete (with Undo, from the page). A count edit commits on blur; a blank
 * or impossible count isn't saved (clearing a field used to write 0). A
 * date already used by another snapshot is refused with a message. The
 * rows go by date, and stay put while a date is edited (Tab from a date
 * into that row's counts mustn't move the row away), with a "Re-sort"
 * chip once the order is stale.
 */

import { useEffect, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { BlurInput } from "@/components/shared/blur-fields";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ResortChip } from "@/components/shared/resort-chip";
import { useStableOrder } from "@/hooks/use-stable-order";
import type { DataEntry, StatusColumn } from "../types";
import { countError, dateError } from "../form";

/** A cell's error message, under its control. */
function CellError({ id, error }: { id: string; error: string | null }) {
  return error ? (
    <p id={id} role="alert" className="mt-1 max-w-[12rem] text-left text-xs text-danger">
      {error}
    </p>
  ) : null;
}

function CountCell({
  entry,
  column,
  onCommit,
}: {
  entry: DataEntry;
  column: StatusColumn;
  onCommit: (count: number) => void;
}) {
  const id = useId();
  const stored = entry.counts[column.id];
  const shown = stored === undefined ? "" : String(stored);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(shown);
    setError(null);
  }, [shown]);
  const commit = () => {
    if (draft.trim() === shown) {
      setError(null);
      return;
    }
    const err = countError(draft, column);
    setError(err);
    if (!err) onCommit(Number(draft));
  };
  return (
    <div>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={draft}
        // A column added after this snapshot has no count: it charts as 0.
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(shown);
            setError(null);
          }
        }}
        aria-label={`${column.name} on ${entry.date}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-8 w-20 bg-surface-deep border-border text-text font-data text-center md:mx-auto"
      />
      <CellError id={`${id}-error`} error={error} />
    </div>
  );
}

function DateCell({
  entry,
  entries,
  today,
  onCommit,
}: {
  entry: DataEntry;
  entries: readonly DataEntry[];
  today: string;
  /** Saves the date; false when it was taken meanwhile. */
  onCommit: (date: string) => boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(entry.date);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(entry.date);
    setError(null);
  }, [entry.date]);
  const commit = (value: string) => {
    if (value === entry.date) {
      setError(null);
      return;
    }
    const err = dateError(value, entries, today, entry.id);
    setError(err);
    if (!err && !onCommit(value)) setError(dateError(value, [], today) ?? "That date is taken.");
  };
  return (
    <div>
      <Input
        type="date"
        max={today}
        value={draft}
        // Committed on blur (or Enter), not per change: typing a year digit by
        // digit passes through dates like 0002-10-05 on the way.
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(entry.date);
            setError(null);
          }
        }}
        aria-label={`Date of the snapshot from ${entry.date}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-8 w-40 bg-surface-deep border-border text-text text-sm"
      />
      <CellError id={`${id}-error`} error={error} />
    </div>
  );
}

export function DataEntryTable({
  entries,
  columns,
  today,
  onUpdateDate,
  onUpdateNote,
  onUpdateCount,
  onRemoveEntry,
}: {
  /** In any order: shown by date. */
  entries: DataEntry[];
  columns: StatusColumn[];
  today: string;
  onUpdateDate: (entry: DataEntry, date: string) => boolean;
  onUpdateNote: (entry: DataEntry, note: string | undefined) => void;
  onUpdateCount: (entry: DataEntry, columnId: string, count: number) => void;
  onRemoveEntry: (entry: DataEntry) => void;
}) {
  const { ordered, isStale, resort } = useStableOrder(
    entries,
    (e) => e.id,
    (a, b) => a.date.localeCompare(b.date)
  );
  const tableColumns: DataTableColumn<DataEntry>[] = [
    {
      key: "date",
      header: "Date",
      primary: true,
      cell: (e) => (
        <DateCell
          entry={e}
          entries={entries}
          today={today}
          onCommit={(date) => onUpdateDate(e, date)}
        />
      ),
    },
    ...columns.map(
      (c): DataTableColumn<DataEntry> => ({
        key: `count-${c.id}`,
        header: c.name,
        align: "center",
        cell: (e) => <CountCell entry={e} column={c} onCommit={(n) => onUpdateCount(e, c.id, n)} />,
      })
    ),
    {
      key: "note",
      header: "Note",
      cell: (e) => (
        <BlurInput
          placeholder="Optional note"
          value={e.description ?? ""}
          onCommit={(v) => onUpdateNote(e, v.trim() ? v.trim() : undefined)}
          className="h-8 min-w-[8rem] bg-surface-deep border-border text-text text-xs"
          aria-label={`Note for ${e.date}`}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      sortLabel: "Actions",
      align: "right",
      cell: (e) => (
        <IconButton
          label={`Delete the snapshot from ${e.date}`}
          icon={<Trash2 aria-hidden="true" />}
          onClick={() => onRemoveEntry(e)}
          className="text-sub hover:text-danger"
          // Lets the page put focus on the next snapshot's Delete after this one goes.
          data-snapshot-delete={e.id}
        />
      ),
    },
  ];
  return (
    <>
      <ResortChip isStale={isStale} onResort={resort} what="Dates" />
      <DataTable columns={tableColumns} rows={ordered} rowKey={(e) => e.id} />
    </>
  );
}
