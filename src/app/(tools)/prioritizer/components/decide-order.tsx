"use client";

/**
 * Decide order: the step that turns the methods' scores into the
 * backlog's one order.
 *
 * 1. What the methods say: each method's place for every item it scored
 *    (rankByMethod: tied items share the average place, shown as "tied
 *    2–3"), and the Borda consensus (bordaConsensus: the mean normalised
 *    place, with how many of the methods scored each item and whether they
 *    disagree). Only methods with 2 or more scored items take part; the
 *    rest are named with the reason. Items no method scored are listed
 *    apart, with links to score them.
 * 2. The team's order: "Use the consensus" fills it; drag rows or move
 *    them with the keyboard (./order-list); "Save order" writes rank 1..N
 *    to the ordered items (and clears it on the rest) in one undoable.
 *    Until then the order is a draft, and the saved one stays in force.
 *    New items stay "Not ordered yet" until they are placed and saved.
 *
 * Every place and consensus comes from lib/prioritization/rank, the code
 * tool.prioritizer.decide_order and set_order run.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ListOrdered, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { SectionCard } from "@/components/shared/section-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { FRAMEWORKS, scoreWithHref } from "@/lib/prioritization/frameworks";
import { method, type MethodId } from "@/lib/prioritization/methods";
import { decidedOrder } from "@/lib/prioritization/rank";
import { cn } from "@/lib/utils";
import { HUB_EDITED, countText, itemName, listText } from "../method-text";
import {
  consensusPlaces,
  consensusScore,
  moveTo,
  placeText,
  placeWord,
  rankOf,
  sameOrder,
  savedOrder,
  type ConsensusPlace,
} from "../order";
import { DISAGREE_SPREAD, analyseOrder, orderVerdict } from "../verdict";
import { OrderList } from "./order-list";

/** "Score with" links for an item no method scored: the methods the hub holds. */
const SCORE_WITH = FRAMEWORKS.filter((f) =>
  (HUB_EDITED as readonly string[]).includes(f.framework)
);

export function DecideOrder({
  items,
  rows,
  onSaveOrder,
}: {
  items: readonly BacklogItem[];
  rows: readonly PrioritizationItem[];
  onSaveOrder: (ids: readonly string[], label: string) => void;
}) {
  const announce = useAnnounce();
  // null: every method that can take part (the default).
  const [picked, setPicked] = useState<MethodId[] | null>(null);
  const [draft, setDraft] = useState<readonly string[] | null>(null);

  const all = useMemo(() => analyseOrder(items, rows), [items, rows]);
  const analysis = useMemo(
    () => (picked ? analyseOrder(items, rows, picked) : all),
    [items, rows, picked, all]
  );
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nameOf = (id: string) => itemName(byId.get(id)?.name);
  const places = useMemo(() => consensusPlaces(analysis.consensus), [analysis]);
  const placeOf = new Map(places.map((p) => [p.row.itemId, p]));

  const saved = useMemo(() => savedOrder(items), [items]);
  // The draft keeps only items that still exist.
  const order = (draft ?? saved).filter((id) => byId.has(id));
  const dirty = draft !== null && !sameOrder(order, saved);
  const inOrder = new Set(order);
  const notOrdered = decidedOrder(items).filter((i) => !inOrder.has(i.id));
  const suggested = places.filter((p) => p.place !== null).map((p) => p.row.itemId);

  const verdict = orderVerdict(analysis, nameOf);

  const toggle = (id: MethodId) => {
    const cur = picked ?? all.used.map((r) => r.method);
    const next = cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id];
    // Hub order, whatever order they were picked in.
    setPicked(all.used.map((r) => r.method).filter((m) => next.includes(m)));
  };
  const fillFromConsensus = () => {
    setDraft(suggested);
    announce(
      `Filled the order from the consensus: ${countText(suggested.length, "item")}. Save order to keep it.`
    );
  };
  const save = () => {
    onSaveOrder(order, `Saved the order of ${countText(order.length, "item")}`);
    setDraft(null);
  };
  const discard = () => {
    setDraft(null);
    announce("Dropped the changes: the saved order stays.");
  };
  const append = (id: string) => {
    setDraft([...order, id]);
    announce(`Added “${nameOf(id)}” to the order at ${order.length + 1}.`);
  };

  const columns: DataTableColumn<ConsensusPlace>[] = [
    {
      key: "place",
      header: "#",
      width: "4rem",
      cell: (p) =>
        p.place === null ? (
          "—"
        ) : (
          <span className="font-data">
            {p.place}
            {p.tied && <span className="ml-1 font-sans text-xs text-sub">tie</span>}
          </span>
        ),
      sortValue: (p) => (p.place === null ? null : -p.place),
      sortLabel: "Consensus place",
    },
    {
      key: "item",
      header: "Item",
      primary: true,
      cell: (p) => nameOf(p.row.itemId),
      sortValue: (p) => nameOf(p.row.itemId).toLowerCase(),
    },
    ...analysis.used.map(
      (r): DataTableColumn<ConsensusPlace> => ({
        key: r.method,
        header: method(r.method).label,
        align: "center",
        cell: (p) => placeText(r, p.row.itemId) ?? <span className="text-sub">—</span>,
        sortValue: (p) => r.normalized.get(p.row.itemId) ?? null,
      })
    ),
    {
      key: "consensus",
      header: "Consensus",
      align: "center",
      cell: (p) => {
        const s = consensusScore(p.row.borda);
        return s === null ? (
          <span className="text-sub">—</span>
        ) : (
          <span className="font-data">{s}</span>
        );
      },
      sortValue: (p) => p.row.borda,
    },
    {
      key: "coverage",
      header: "Scored in",
      cell: (p) => {
        const n = analysis.used.length;
        // Fewer than half the methods: its consensus rests on little.
        const thin = p.row.coverage > 0 && p.row.coverage * 2 < n;
        return (
          <span className={cn(thin && "text-warning")}>
            {p.row.coverage} of {n}
            {thin && <span className="ml-1 text-xs">(few methods)</span>}
          </span>
        );
      },
      sortValue: (p) => p.row.coverage,
    },
    {
      key: "agree",
      header: "Agreement",
      // The spread: how far apart its best and worst places are, as a share
      // of the list. Over half, the methods disagree on it.
      cell: (p) => {
        const spread = p.row.spread;
        if (spread === null) return <span className="text-xs text-sub">One method</span>;
        const apart = (
          <span className="ml-1 text-xs text-sub">{Math.round(spread * 100)}% apart</span>
        );
        return spread > DISAGREE_SPREAD ? (
          <span>
            <span className="inline-flex rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">
              Methods disagree
            </span>
            {apart}
          </span>
        ) : (
          <span>
            <span className="text-xs text-text">Agree</span>
            {apart}
          </span>
        );
      },
      sortValue: (p) => p.row.spread,
    },
    {
      key: "saved",
      header: "Saved order",
      align: "center",
      cell: (p) => {
        const rank = rankOf(byId.get(p.row.itemId) ?? {});
        return rank === undefined ? (
          <span className="text-xs text-sub">Not ordered yet</span>
        ) : (
          rank
        );
      },
      sortValue: (p) => {
        const rank = rankOf(byId.get(p.row.itemId) ?? {});
        return rank === undefined ? null : -rank;
      },
    },
  ];

  const scoredPlaces = places.filter((p) => p.place !== null);
  const skippedText = all.skipped.map(
    (s) => `${method(s.method).label} (${s.n === 0 ? "no item scored" : "only 1 item scored"})`
  );

  return (
    <div className="space-y-4">
      {/* The page's verdict covers every method; this one says what the picked ones say. */}
      {picked && (
        <p className="text-sm font-medium text-text">
          With {listText(analysis.used.map((r) => method(r.method).label)) || "no method"}:{" "}
          {verdict[0].toLowerCase()}
          {verdict.slice(1)}
        </p>
      )}

      <SectionCard title="1. What the methods say" icon={Scale}>
        {all.used.length === 0 ? (
          <p className="text-sm text-sub">
            No method has 2 or more items scored yet. Score items in the table above, or with a
            method&apos;s tool, and each method&apos;s order shows here.
          </p>
        ) : (
          <>
            <div
              className="mb-3 flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Methods in the consensus"
            >
              {all.used.map((r) => {
                const on = analysis.used.some((u) => u.method === r.method);
                return (
                  <Button
                    key={r.method}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => toggle(r.method)}
                  >
                    {method(r.method).label}
                    <span className="ml-1 font-mono text-xs opacity-80">{r.n}</span>
                  </Button>
                );
              })}
            </div>
            <p className="mb-3 text-xs text-sub">
              Each method&apos;s place for the items it scored (tied items share the places they
              span), and the consensus: the average place across the methods that scored the item,
              100 when every one puts it first.
              {skippedText.length > 0 && ` Left out: ${listText(skippedText)}.`}
            </p>
            {analysis.used.length === 0 ? (
              <p className="text-sm text-sub">Pick at least one method to see a consensus.</p>
            ) : scoredPlaces.length > 0 ? (
              <DataTable columns={columns} rows={scoredPlaces} rowKey={(p) => p.row.itemId} />
            ) : null}
          </>
        )}
        {analysis.used.length > 0 && analysis.unscored.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-sub">
              Not scored by any method in the consensus ({analysis.unscored.length})
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {analysis.unscored.map((id) => (
                <li key={id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-text">{nameOf(id)}</span>
                  <span className="text-xs text-sub">Score with</span>
                  {SCORE_WITH.map((f) => (
                    <Link
                      key={f.id}
                      href={scoreWithHref(f, id)}
                      className="text-xs text-accent underline-offset-2 hover:underline"
                    >
                      {f.label}
                      <span className="sr-only">: {nameOf(id)}</span>
                    </Link>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="2. Your order"
        icon={ListOrdered}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={fillFromConsensus}
              disabled={suggested.length === 0}
            >
              Use the consensus
            </Button>
            {dirty && (
              <>
                <Button type="button" size="sm" onClick={save}>
                  Save order
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={discard}>
                  Discard changes
                </Button>
              </>
            )}
          </div>
        }
      >
        <p className="mb-3 text-xs text-sub">
          The order the team agrees, which Sprint Planning imports in. Drag a row by its grip, or
          focus the grip and press the arrow keys.
          {dirty && " Not saved yet: the saved order stays until you save."}
        </p>
        {order.length === 0 ? (
          <p className="text-sm text-sub">
            Nothing is ordered yet. Use the consensus to start, or add items one by one below.
          </p>
        ) : (
          <OrderList
            ids={order}
            label="Your order"
            nameOf={nameOf}
            meta={(id) => {
              const p = placeOf.get(id);
              if (!p || p.place === null) return "No method scored it";
              const r = p.row;
              const methods = analysis.used.filter((u) => u.normalized.has(id));
              const words = methods.map((u) => `${placeWord(u, id)} in ${method(u.method).label}`);
              return `Consensus ${p.place}${p.tied ? " (tie)" : ""}: ${listText(words)}${r.spread !== null && r.spread > DISAGREE_SPREAD ? ". Methods disagree" : ""}`;
            }}
            onMove={(id, to) => setDraft(moveTo(order, id, to))}
            onRemove={(id) => {
              setDraft(order.filter((x) => x !== id));
              announce(`Took “${nameOf(id)}” out of the order.`);
            }}
          />
        )}
        {notOrdered.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-sub">
              Not ordered yet ({notOrdered.length})
            </h3>
            <ul className="mt-2 space-y-1.5" aria-label="Not ordered yet">
              {notOrdered.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 break-words text-text">{nameOf(i.id)}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => append(i.id)}
                    aria-label={`Add “${nameOf(i.id)}” to the order`}
                  >
                    Add to the order
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
