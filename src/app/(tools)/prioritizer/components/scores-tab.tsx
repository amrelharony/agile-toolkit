"use client";

/**
 * Tab "All methods": every backlog item scored by every method, side by
 * side, with a one-sentence verdict. A DataTable: sortable by any method,
 * one card per item on a phone.
 *
 * MoSCoW, WSJF, RICE and Value/Effort come from each item's own inputs
 * (the table above). ICE, Kano and Cost of Delay come from the latest row
 * in those tools linked to the item; when an item has no score in a method
 * the cell links to the method's tool with the item preselected.
 */

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { SectionCard } from "@/components/shared/section-card";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  FRAMEWORKS,
  scoreWithHref,
  type PrioritizationFramework,
} from "@/lib/prioritization/frameworks";
import {
  evaluateItem,
  method,
  type MethodId,
  type MethodScore,
} from "@/lib/prioritization/methods";
import { rankByMethod, decidedOrder } from "@/lib/prioritization/rank";
import { itemName, methodText } from "../method-text";
import { methodsVerdict } from "../verdict";

/** Methods whose result is a number, set in the data font. */
const NUMERIC = new Set<string>(["wsjf", "rice", "ice", "cost-of-delay"]);

interface Row {
  item: BacklogItem;
  results: Record<MethodId, MethodScore>;
}

export function ScoresTab({
  items,
  rows,
}: {
  items: readonly BacklogItem[];
  rows: readonly PrioritizationItem[];
}) {
  const tableRows: Row[] = decidedOrder(items).map((item) => ({
    item,
    results: evaluateItem(item, rows),
  }));
  // Each method's normalised place sorts its column: Cost of Delay's lanes
  // and the quadrants order by more than one number.
  const rankings = new Map(
    FRAMEWORKS.map((f) => [f.framework, rankByMethod(items, rows, f.framework as MethodId)])
  );

  const cell = (f: PrioritizationFramework, r: Row) => {
    const id = f.framework as MethodId;
    const s = r.results[id];
    const name = itemName(r.item.name);
    if (s.sortKey === null) {
      return (
        <Link
          href={scoreWithHref(f, r.item.id)}
          className="text-xs text-accent underline-offset-2 hover:underline"
        >
          Score with {f.label}
          <span className="sr-only">: {name}</span>
        </Link>
      );
    }
    return <span className={NUMERIC.has(id) ? "font-data" : undefined}>{methodText(id, s)}</span>;
  };

  const columns: DataTableColumn<Row>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      cell: (r) => itemName(r.item.name, 80),
      sortValue: (r) => r.item.name.trim().toLowerCase(),
    },
    ...FRAMEWORKS.map(
      (f): DataTableColumn<Row> => ({
        key: f.framework,
        header: f.label,
        cell: (r) => cell(f, r),
        sortValue: (r) => {
          const ranking = rankings.get(f.framework);
          if (ranking) return ranking.normalized.get(r.item.id) ?? null;
          return r.results[f.framework as MethodId].sortKey;
        },
      })
    ),
  ];

  return (
    <SectionCard title="All methods" icon={LayoutGrid}>
      <p className="mb-2 text-sm font-medium text-text">{methodsVerdict(items, rows)}</p>
      <p className="mb-3 text-xs text-sub">
        MoSCoW, WSJF, RICE and Value/Effort use each item&apos;s inputs above. ICE, Kano and Cost of
        Delay show the latest score linked from {method("ice").label}, {method("kano").label} and{" "}
        {method("cost-of-delay").label} tools.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-sub">Add backlog items to compare every method side by side.</p>
      ) : (
        <DataTable columns={columns} rows={tableRows} rowKey={(r) => r.item.id} />
      )}
    </SectionCard>
  );
}
