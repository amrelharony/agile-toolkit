"use client";

/**
 * Shared backlog links for the prioritization method tools.
 *
 * - `useBacklogImport` + `ImportFromBacklog`: pick a backlog item to prefill
 *   the tool's add form. The next row added links to that item. A
 *   "Score with…" link (`?backlogItem=<id>`) preselects the item on load.
 * - `AddToBacklogButton`: create a backlog item from an unlinked row.
 * - `LinkedChip`: the row is linked; links to the Backlog Prioritizer.
 * - `BacklogRowLink`: whichever of the two a row needs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Link2, ListPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  frameworkFor,
  readBacklogItemParam,
  type FrameworkKey,
  type RowFields,
} from "@/lib/prioritization/frameworks";
import { addRowToBacklog, linkedBacklogItem } from "@/lib/prioritization/backlog-links";

const NO_ITEMS: BacklogItem[] = [];
const NO_ROWS: PrioritizationItem[] = [];

export const BACKLOG_PATH = "/prioritizer";

const itemName = (item: Pick<BacklogItem, "name">) => item.name?.trim() || "Untitled item";

export interface BacklogImport {
  framework: FrameworkKey;
  /** The shared backlog, in its own order. */
  items: BacklogItem[];
  /** The item the next added row will link to. */
  pending: BacklogItem | null;
  pick: (item: BacklogItem) => void;
  clear: () => void;
  /** Backlog items that already have a row in this method. */
  scoredIds: ReadonlySet<string>;
}

/**
 * State for "Import from backlog" in one method tool.
 *
 * `onPick` gets the chosen item and the add-form prefill for this method
 * (the inputs the backlog holds; empty for ICE, Kano and Cost of Delay).
 * Pass `pending?.id` to `linkNewRow` when the row is added, then `clear()`.
 */
export function useBacklogImport(
  framework: FrameworkKey,
  onPick: (item: BacklogItem, prefill: RowFields) => void
): BacklogImport {
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const rows = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });

  const pick = useCallback(
    (item: BacklogItem) => {
      setPendingId(item.id);
      onPickRef.current(item, frameworkFor(framework)?.fromBacklog?.(item) ?? {});
    },
    [framework]
  );
  const clear = useCallback(() => setPendingId(null), []);

  // A "Score with…" link: preselect ?backlogItem=<id> once that item has
  // loaded. Read from window.location in an effect so the page needs no
  // Suspense boundary for useSearchParams.
  const urlHandled = useRef(false);
  useEffect(() => {
    if (urlHandled.current) return;
    const id = readBacklogItemParam(window.location.search);
    if (!id) {
      urlHandled.current = true;
      return;
    }
    const item = items.find((b) => b.id === id);
    if (item) {
      urlHandled.current = true;
      pick(item);
    }
  }, [items, pick]);

  const pending = pendingId ? (items.find((b) => b.id === pendingId) ?? null) : null;
  const scoredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows)
      if (r.framework === framework && r.backlogItemId) ids.add(r.backlogItemId);
    return ids;
  }, [rows, framework]);

  return { framework, items, pending, pick, clear, scoredIds };
}

/** "Import from backlog" menu, plus a chip naming the item the next row links to. */
export function ImportFromBacklog({ link }: { link: BacklogImport }) {
  const { items, pending, pick, clear, scoredIds } = link;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div aria-live="polite" className="flex min-w-0 items-center">
        {pending && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-accent/30 bg-accent/10 py-0.5 pl-2 pr-0.5 text-xs text-accent">
            <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="max-w-[14rem] truncate">Linked to {itemName(pending)}</span>
            <IconButton
              label={`Don't link to ${itemName(pending)}`}
              icon={<X />}
              tooltip={false}
              onClick={clear}
              className="h-6 w-6 md:h-6 md:w-6 text-accent hover:text-text min-touch-coarse"
            />
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <ListPlus aria-hidden="true" />
            Import from backlog
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-xs font-normal text-sub">
            {items.length === 0 ? "Your backlog is empty" : "Pick a backlog item to score"}
          </DropdownMenuLabel>
          {items.length === 0 ? (
            <DropdownMenuItem asChild>
              <Link href={BACKLOG_PATH}>Open the Backlog Prioritizer</Link>
            </DropdownMenuItem>
          ) : (
            items.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => pick(item)}>
                <span className="min-w-0 flex-1 truncate">{itemName(item)}</span>
                {scoredIds.has(item.id) && <span className="text-xs text-sub">scored</span>}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Shows that a row is linked to a backlog item; opens the Backlog Prioritizer. */
export function LinkedChip({ name }: { name: string }) {
  return (
    <Link
      href={BACKLOG_PATH}
      title={`Linked to ${name} in the backlog`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-touch-coarse"
    >
      <Link2 className="h-3 w-3" aria-hidden="true" />
      Backlog
      <span className="sr-only">: linked to {name}, open the Backlog Prioritizer</span>
    </Link>
  );
}

/** Create a backlog item from this row (its title and mapped inputs) and link the row. */
export function AddToBacklogButton({ row }: { row: PrioritizationItem }) {
  return (
    // The app root has a provider; this one keeps the tooltip working
    // wherever the button renders on its own.
    <TooltipProvider delayDuration={300}>
      <IconButton
        label={`Add ${row.title} to the backlog`}
        icon={<ListPlus />}
        onClick={() => addRowToBacklog(row)}
        className="h-7 w-7 md:h-7 md:w-7 text-sub hover:text-accent min-touch-coarse"
      />
    </TooltipProvider>
  );
}

/**
 * The chip when the row is linked to a backlog item that still exists,
 * else "Add to backlog". Example rows stay out of the shared backlog.
 */
export function BacklogRowLink({ row }: { row: PrioritizationItem | undefined }) {
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  if (!row) return null;
  const linked = linkedBacklogItem(row, items);
  if (linked) return <LinkedChip name={itemName(linked)} />;
  if (isExampleId(row.id)) return null;
  return <AddToBacklogButton row={row} />;
}
