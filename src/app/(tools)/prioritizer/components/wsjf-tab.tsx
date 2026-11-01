"use client";

/**
 * Tab WSJF: the backlog by Weighted Shortest Job First, (business value +
 * time criticality + risk reduction) ÷ job size, highest first, items not
 * scored last. Every part on the Fibonacci scale 1–20 (an off-scale value
 * an item already holds reads "custom"); the score, the floor of 1 on the
 * job size and the place come from the method registry and rank.ts. A WSJF
 * row linked before Phase 7 fills the parts its item's old defaults hide
 * (`rows`: methods withLegacyLinks), as the WSJF tool reads them.
 */

import { useMemo, useRef } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { SectionCard } from "@/components/shared/section-card";
import { ScaleValue } from "@/components/shared/scale-picker";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import {
  evaluateItemIn,
  method,
  withLegacyLinks,
  type MethodScore,
} from "@/lib/prioritization/methods";
import { FIBONACCI_STEPS } from "@/lib/prioritization/methods/fibonacci";
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

const NO_ROWS: readonly PrioritizationItem[] = [];

const PARTS = [
  { key: "businessValue", label: "Business value" },
  { key: "timeCriticality", label: "Time criticality" },
  { key: "riskReduction", label: "Risk reduction" },
  { key: "jobSize", label: "Job size" },
] as const;

export function WSJFTab({
  items,
  rows: methodRows = NO_ROWS,
}: {
  items: readonly BacklogItem[];
  /** The workspace's method rows: links made before Phase 7 read through them. */
  rows?: readonly PrioritizationItem[];
}) {
  const rows = useMemo<Row[]>(
    () =>
      // The engine's reading: old defaults cleared, a legacy link's parts
      // filled in, the legacy value read onto the one value field.
      items.map((i) => ({
        item: readBacklogItem(withLegacyLinks(i, methodRows)),
        result: evaluateItemIn(i, methodRows, "wsjf"),
      })),
    [items, methodRows]
  );
  const ranking = useMemo(() => rankByMethod(items, methodRows, "wsjf"), [items, methodRows]);
  const m = method("wsjf");
  const box = useRef<HTMLDivElement>(null);
  useTableName(box, "The backlog by WSJF");

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
    ...PARTS.map(
      (p): DataTableColumn<Row> => ({
        key: p.key,
        header: p.label,
        align: "center",
        cell: (r) =>
          r.item[p.key] === undefined ? (
            <span className="text-sub">—</span>
          ) : (
            <span className="font-data text-sub">
              <ScaleValue steps={FIBONACCI_STEPS} value={r.item[p.key]} />
            </span>
          ),
        sortValue: (r) => r.item[p.key] ?? null,
      })
    ),
    {
      key: "score",
      header: "WSJF",
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
    <SectionCard title="WSJF Prioritization">
      {/* In the body, where it wraps: beside the title it was wider than a 375 px screen. */}
      <p className="mb-3 text-xs text-sub">
        (Business value + Time criticality + Risk reduction) ÷ Job size
      </p>
      <div ref={box}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.item.id}
          defaultSort={{ key: "score", dir: "desc" }}
        />
      </div>
    </SectionCard>
  );
}
