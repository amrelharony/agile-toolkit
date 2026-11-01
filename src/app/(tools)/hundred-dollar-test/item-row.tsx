"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { IconButton } from "@/components/ui/icon-button";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { ITEM_TITLE_MAX, allocationOf, HUNDRED } from "@/lib/hundred-dollar/allocation";
import { AmountInput } from "./amount-input";

/**
 * One item of the agreed split: its title (renamed in place), a bar of its
 * share of the $100, the amount (saved when the box is left) with the note
 * when the amount was capped, and Delete (the page offers Undo).
 */
export function ItemRow({
  row,
  note,
  readOnly,
  onRename,
  onAmount,
  onDelete,
}: {
  row: PrioritizationItem;
  /** Why the last amount typed here was changed; null when it went in as typed. */
  note: string | null;
  readOnly: boolean;
  onRename: (title: string) => void;
  /** Save a typed amount; returns what was saved. */
  onAmount: (typed: number) => number | null;
  onDelete: () => void;
}) {
  const edit = useInlineEdit();
  const noteId = useId();
  const amount = allocationOf(row);
  const width = amount === null ? 0 : Math.min(100, (amount / HUNDRED) * 100);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded border border-border bg-surface-deep p-3">
      <div className="min-w-0 flex-1 basis-40">
        {edit.editing ? (
          <InlineItemEditor
            label="Rename item"
            title={row.title}
            titleLabel="Item"
            titleMaxLength={ITEM_TITLE_MAX}
            onDone={(next, { refocus }) => {
              edit.stop({ refocus });
              if (next) onRename(next.title);
            }}
          />
        ) : (
          <button
            ref={edit.triggerRef}
            type="button"
            onClick={edit.start}
            disabled={readOnly}
            title="Click to rename"
            className="block w-full cursor-text break-words rounded-sm text-left text-sm text-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-default disabled:hover:text-text"
          >
            {row.title}
            <span className="sr-only"> (rename)</span>
          </button>
        )}
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-surface" aria-hidden="true">
          <div className="h-1.5 bg-accent" style={{ width: `${width}%` }} />
        </div>
        {note && (
          <p id={noteId} role="alert" className="mt-1 text-xs text-warning">
            {note}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm text-sub" aria-hidden="true">
          $
        </span>
        <AmountInput
          value={amount}
          label={`Dollars allocated to ${row.title}`}
          describedBy={note ? noteId : undefined}
          disabled={readOnly}
          onCommit={onAmount}
        />
        <IconButton
          label={`Delete ${row.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          disabled={readOnly}
          onClick={onDelete}
        />
      </div>
    </li>
  );
}
