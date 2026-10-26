"use client";

/**
 * Tab MoSCoW: the backlog by bucket (Must, Should, Could, Won't have this
 * time), each bucket in the decided order and reorderable (drag a row by
 * its grip, or the arrow keys on it, as in Decide order). Then "Not sorted
 * yet": a bucket is never a default, and an item whose only bucket is the
 * old "Add item" default reads as not sorted (the registry's reading).
 *
 * A reorder saves at once, with Undo: the bucket's items swap among the
 * places they hold in the backlog's order, so nothing in another bucket
 * moves (./order groupReorder). A bucket's items that weren't ordered yet
 * get places as they are moved.
 */

import { useMemo } from "react";
import { evaluateItemIn } from "@/lib/prioritization/methods";
import { isMoscowBucket } from "@/lib/prioritization/methods/moscow";
import { decidedOrder } from "@/lib/prioritization/rank";
import { cn } from "@/lib/utils";
import type { BacklogItem, MoSCoWCategory } from "../types";
import { MOSCOW_CATEGORIES, MOSCOW_CONFIG, TONE_CLASS } from "../constants";
import { countText, itemName } from "../method-text";
import { groupReorder, moveTo, rankOf } from "../order";
import { OrderList } from "./order-list";

export function MoSCoWTab({
  items,
  onReorder,
}: {
  items: readonly BacklogItem[];
  /** Save a whole-backlog order. Absent: the buckets are lists only. */
  onReorder?: (ids: readonly string[], label: string) => void;
}) {
  const { groups, unsorted } = useMemo(() => {
    const result = Object.fromEntries(
      MOSCOW_CATEGORIES.map((k) => [k, [] as BacklogItem[]])
    ) as Record<MoSCoWCategory, BacklogItem[]>;
    const rest: BacklogItem[] = [];
    for (const item of decidedOrder(items)) {
      const bucket = evaluateItemIn(item, [], "moscow").bucket;
      if (isMoscowBucket(bucket)) result[bucket].push(item);
      else rest.push(item);
    }
    return { groups: result, unsorted: rest };
  }, [items]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const nameOf = (id: string) => itemName(byId.get(id)?.name);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {MOSCOW_CATEGORIES.map((category) => {
        const cfg = MOSCOW_CONFIG[category];
        const tone = TONE_CLASS[cfg.tone];
        const members = groups[category];
        const ids = members.map((i) => i.id);
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
            {members.length === 0 ? (
              <p className="mt-2 text-xs italic text-sub">Nothing in this bucket.</p>
            ) : onReorder && members.length > 1 ? (
              <OrderList
                className="mt-2"
                ids={ids}
                label={`${cfg.label}, in order`}
                where={` in ${cfg.label}`}
                nameOf={nameOf}
                meta={(id) => {
                  const rank = rankOf(byId.get(id) ?? {});
                  return rank === undefined ? "Not ordered yet" : `Backlog order ${rank}`;
                }}
                onMove={(id, to) =>
                  onReorder(
                    groupReorder(items, moveTo(ids, id, to)),
                    `Moved “${nameOf(id)}” to ${to + 1} of ${ids.length} in ${cfg.label}`
                  )
                }
              />
            ) : (
              <ol className="mt-2 space-y-1 text-sm text-text">
                {members.map((i) => (
                  <li key={i.id} className="break-words">
                    {nameOf(i.id)}
                  </li>
                ))}
              </ol>
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
