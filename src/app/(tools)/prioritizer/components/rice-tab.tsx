"use client";

/**
 * Tab RICE: the backlog by (reach × impact × confidence) ÷ effort, highest
 * first, items not scored last. Reach is counted per the item's period and
 * normalised to a quarter for the score, so items counted per week and per
 * year compare; an effort below the 0.5 person-month minimum counts as 0.5
 * and says so. The score and the place come from the method registry and
 * rank.ts. A RICE row linked before Phase 7 fills the inputs its item's old
 * defaults hide (`rows`: methods withLegacyLinks), as the RICE tool reads
 * them.
 */

import { useMemo, useRef } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { SectionCard } from "@/components/shared/section-card";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import {
  evaluateItemIn,
  method,
  withLegacyLinks,
  type MethodScore,
} from "@/lib/prioritization/methods";
import { REACH_PERIOD_LABEL } from "@/lib/prioritization/methods/rice";
import { rankByMethod } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import type { BacklogItem } from "../types";
import { itemName } from "../method-text";
import { placeText } from "../order";
import { useTableName } from "../use-table-name";
import { ScoreBadge } from "./cells";

interface Row {
  item: BacklogItem;
  result: MethodScore;
}

const dash = <span className="text-sub">—</span>;

const NO_ROWS: readonly PrioritizationItem[] = [];

export function RICETab({
  items,
  rows: methodRows = NO_ROWS,
}: {
  items: readonly BacklogItem[];
  /** The workspace's method rows: links made before Phase 7 read through them. */
  rows?: readonly PrioritizationItem[];
}) {
  const rows = useMemo<Row[]>(
    () =>
      items.map((i) => ({
        item: readBacklogItem(withLegacyLinks(i, methodRows)),
        result: evaluateItemIn(i, methodRows, "rice"),
      })),
    [items, methodRows]
  );
  const ranking = useMemo(() => rankByMethod(items, methodRows, "rice"), [items, methodRows]);
  const m = method("rice");
  const box = useRef<HTMLDivElement>(null);
  useTableName(box, "The backlog by RICE");

  const columns: DataTableColumn<Row>[] = [
    {
      key: "place",
      header: "Place",
      width: "5rem",
      cell: (r) => placeText(ranking ?? undefined, r.item.id) ?? "—",
    },
    {
      key: "item",
      header: "Item",
      primary: true,
      cell: (r) => (
        <>
          <span className="font-medium text-text">{itemName(r.item.name, 80)}</span>
          {r.item.description && (
            <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-sub">
              {r.item.description}
            </span>
          )}
        </>
      ),
      sortValue: (r) => r.item.name.trim().toLowerCase(),
    },
    {
      key: "reach",
      header: "Reach",
      align: "center",
      cell: (r) =>
        r.item.reach === undefined ? (
          dash
        ) : (
          <span className="font-data text-sub">
            {r.item.reach.toLocaleString("en-US")}{" "}
            {REACH_PERIOD_LABEL[r.item.reachPeriod ?? "quarter"]}
          </span>
        ),
      sortValue: (r) => {
        const perQuarter = r.result.extra?.reachPerQuarter;
        return typeof perQuarter === "number" ? perQuarter : (r.item.reach ?? null);
      },
    },
    {
      key: "impact",
      header: "Impact",
      align: "center",
      cell: (r) =>
        r.item.impact === undefined ? (
          dash
        ) : (
          <span className="font-data text-sub">{r.item.impact}x</span>
        ),
      sortValue: (r) => r.item.impact ?? null,
    },
    {
      key: "confidence",
      header: "Confidence",
      align: "center",
      cell: (r) =>
        r.item.confidence === undefined ? (
          dash
        ) : (
          <span className="font-data text-sub">{r.item.confidence}%</span>
        ),
      sortValue: (r) => r.item.confidence ?? null,
    },
    {
      key: "effort",
      header: "Effort",
      align: "center",
      cell: (r) =>
        r.item.effort === undefined ? (
          dash
        ) : (
          <span className="font-data text-sub">{r.item.effort} pm</span>
        ),
      sortValue: (r) => r.item.effort ?? null,
    },
    {
      key: "score",
      header: "RICE",
      align: "center",
      cell: (r) =>
        r.result.score === null ? (
          <span className="text-xs text-sub">Not scored</span>
        ) : (
          <>
            <ScoreBadge value={m.format(r.result.score)} />
            {r.result.warnings.length > 0 && (
              <span className="mt-1 block text-xs text-warning">{r.result.warnings.join(" ")}</span>
            )}
          </>
        ),
      sortValue: (r) => r.result.score,
    },
  ];

  return (
    <SectionCard title="RICE Prioritization">
      {/* In the body, where it wraps: beside the title it squeezed the title to an ellipsis at 375 px. */}
      <p className="mb-3 text-xs text-sub">(Reach × Impact × Confidence) ÷ Effort</p>
      <div ref={box}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.item.id}
          defaultSort={{ key: "score", dir: "desc" }}
        />
      </div>
      <p className="mt-3 text-xs text-sub">
        Reach counts per quarter in the score, whatever period each item is counted over.
      </p>
    </SectionCard>
  );
}
