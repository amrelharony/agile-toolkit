"use client";

/**
 * Tab MoSCoW: the backlog by bucket (Must, Should, Could, Won't have this
 * time), each bucket in the decided order. Then "Not sorted yet": a bucket
 * is never a default, and an item whose only bucket is the old "Add item"
 * default reads as not sorted (the registry's reading), unless a MoSCoW row
 * linked to it before Phase 7 holds its real bucket (`rows`: methods
 * withLegacyLinks, as the MoSCoW tool reads it).
 *
 * A bucket's ordered items are reorderable (drag a row by its grip, or the
 * arrow keys on it, as in Decide order). A reorder saves at once, with
 * Undo: they swap among the places they hold in the backlog's order, so
 * nothing in another bucket moves (./order groupReorder). A bucket's items
 * not ordered yet follow as a fixed list with a way to Decide order: a move
 * here can't give them a place against the rest of the backlog (ordering a
 * Could by moving it would put it ahead of every unordered Must).
 */

import { useMemo } from "react";
import { ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { evaluateItemIn } from "@/lib/prioritization/methods";
import { isMoscowBucket } from "@/lib/prioritization/methods/moscow";
import { decidedOrder } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import type { BacklogItem, MoSCoWCategory } from "../types";
import { MOSCOW_CATEGORIES, MOSCOW_CONFIG, TONE_CLASS } from "../constants";
import { countText, itemName } from "../method-text";
import { groupReorder, moveTo, rankOf } from "../order";
import { OrderList } from "./order-list";

const NO_ROWS: readonly PrioritizationItem[] = [];

export function MoSCoWTab({
  items,
  rows = NO_ROWS,
  onReorder,
  onDecideOrder,
}: {
  items: readonly BacklogItem[];
  /** The workspace's method rows: links made before Phase 7 read through them. */
  rows?: readonly PrioritizationItem[];
  /** Save a whole-backlog order. Absent: the buckets are lists only. */
  onReorder?: (ids: readonly string[], label: string) => void;
  /** Open the Decide order step, where items not ordered yet get their places. */
  onDecideOrder?: () => void;
}) {
  const { groups, unsorted } = useMemo(() => {
    const result = Object.fromEntries(
      MOSCOW_CATEGORIES.map((k) => [k, [] as BacklogItem[]])
    ) as Record<MoSCoWCategory, BacklogItem[]>;
    const rest: BacklogItem[] = [];
    for (const item of decidedOrder(items)) {
      const bucket = evaluateItemIn(item, rows, "moscow").bucket;
      if (isMoscowBucket(bucket)) result[bucket].push(item);
      else rest.push(item);
    }
    return { groups: result, unsorted: rest };
  }, [items, rows]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const nameOf = (id: string) => itemName(byId.get(id)?.name);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {MOSCOW_CATEGORIES.map((category) => {
        const cfg = MOSCOW_CONFIG[category];
        const tone = TONE_CLASS[cfg.tone];
        const members = groups[category];
        // decidedOrder lists the ordered items first, by rank.
        const ordered = members.filter((i) => rankOf(i) !== undefined);
        const unordered = members.filter((i) => rankOf(i) === undefined);
        const ids = ordered.map((i) => i.id);
        return (
          <section
            key={category}
            aria-label={cfg.label}
            className={cn("rounded-lg border bg-card p-4", tone.border)}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full",
                  tone.bg,
                  tone.border,
                  "border"
                )}
                aria-hidden="true"
              />
              <span className={tone.text}>{cfg.label}</span>
              <span className="ml-auto font-data text-xs font-normal text-sub">
                {countText(members.length, "item")}
              </span>
            </h3>
            {members.length === 0 && (
              <p className="mt-2 text-xs italic text-sub">Nothing in this bucket.</p>
            )}
            {onReorder && ordered.length > 1 ? (
              <OrderList
                className="mt-2"
                ids={ids}
                label={`${cfg.label}, in order`}
                where={` in ${cfg.label}`}
                nameOf={nameOf}
                meta={(id) => `Backlog order ${rankOf(byId.get(id) ?? {})}`}
                onMove={(id, to) =>
                  onReorder(
                    groupReorder(items, moveTo(ids, id, to)),
                    `Moved “${nameOf(id)}” to ${to + 1} of ${ids.length} in ${cfg.label}`
                  )
                }
              />
            ) : (
              ordered.length > 0 && (
                <ol className="mt-2 space-y-1 text-sm text-text">
                  {ordered.map((i) => (
                    <li key={i.id} className="break-words">
                      {nameOf(i.id)}
                    </li>
                  ))}
                </ol>
              )
            )}
            {unordered.length > 0 && (
              <div className={cn(ordered.length > 0 && "mt-3 border-t border-border pt-3")}>
                {ordered.length > 0 && (
                  <h4 className="text-xs font-medium text-sub">
                    Not ordered yet ({unordered.length})
                  </h4>
                )}
                <ul
                  className="mt-2 space-y-1 text-sm text-text"
                  aria-label={`${cfg.label}, not ordered yet`}
                >
                  {unordered.map((i) => (
                    <li key={i.id} className="break-words">
                      {nameOf(i.id)}
                    </li>
                  ))}
                </ul>
                {onReorder && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sub">
                    {ordered.length === 0 ? "Not ordered yet: they" : "They"} get their places
                    against the whole backlog in Decide order.
                    {onDecideOrder && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        aria-label={`Decide order for ${cfg.label}`}
                        onClick={onDecideOrder}
                      >
                        <ListOrdered aria-hidden="true" />
                        Decide order
                      </Button>
                    )}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
      {unsorted.length > 0 && (
        <section
          aria-label="Not sorted yet"
          className="rounded-lg border border-border bg-card p-4 lg:col-span-2"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-sub">
            Not sorted yet
            <span className="ml-auto font-data text-xs font-normal">
              {countText(unsorted.length, "item")}
            </span>
          </h3>
          <p className="mt-1 text-xs text-sub">
            Pick a bucket in the table above (the MoSCoW column), or sort them in the MoSCoW tool.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unsorted.map((item) => (
              <li
                key={item.id}
                className="rounded-full border border-border px-2.5 py-0.5 text-sm text-sub"
              >
                {nameOf(item.id)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
