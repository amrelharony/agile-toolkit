"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Compass, Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateCynefinPrompts } from "@/lib/ai-prompts/cynefin";
import { CYNEFIN_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { sendHandoff } from "@/lib/handoffs/send";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/handoffs/targets/hypothesis";
import type { HandoffLink } from "@/lib/handoffs/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CynefinDomain,
  CynefinItem,
  HypothesisTracker,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  DOMAINS,
  DOMAIN_IDS,
  cynefinVerdict,
  groupByDomain,
  hypothesisSourceOf,
  hypothesisStateOf,
  planOf,
} from "@/lib/cynefin/model";
import { buildExample } from "./example";
import { ItemCard, itemControlId } from "./item-card";
import { cynefinToMarkdown } from "./markdown";
import { DOMAIN_TONE, SenseForm, type NewCynefinItem } from "./sense-form";

const NO_ITEMS: CynefinItem[] = [];
const NO_TRACKERS: HypothesisTracker[] = [];

/** A canvas card's link to an item, as the delete found it. */
type CardLink = { id: string; sourceRef: NonNullable<WhiteboardObject["sourceRef"]> };

/** The canvas cards pinned to item `id` (the store's delete unpins them). */
function cardLinksTo(id: string): CardLink[] {
  return (useWorkspaceStore.getState().whiteboardObjects ?? []).flatMap((o) =>
    o.sourceRef && o.sourceRef.tool === "cynefin" && o.sourceRef.entityId === id
      ? [{ id: o.id, sourceRef: o.sourceRef }]
      : []
  );
}

/**
 * Re-pin cards a delete unpinned (its Undo), each only while it is still
 * there and unpinned, as lib/decisions/store's restoreDecisionRecord does.
 */
function repinCards(cards: readonly CardLink[]): void {
  if (cards.length === 0) return;
  const objects = new Map(
    (useWorkspaceStore.getState().whiteboardObjects ?? []).map((o) => [o.id, o])
  );
  const at = new Date().toISOString();
  const back = cards.flatMap(({ id, sourceRef }) => {
    const o = objects.get(id);
    // version + updatedAt bump so peers accept the change (last write wins).
    return o && !o.sourceRef ? [{ ...o, sourceRef, version: o.version + 1, updatedAt: at }] : [];
  });
  if (back.length > 0) useWorkspaceStore.getState().upsertWhiteboardObjects(back);
}

/**
 * Cynefin: place each problem in a domain to choose how to act on it.
 * Guided questions suggest the domain and the team confirms it (nothing is
 * filed by default); items are edited in place, deleted with Undo, and a
 * complex one can be turned into a hypothesis to test in the Hypothesis
 * Tracker. The recipes, the suggestion and the verdict come from
 * lib/cynefin, which the agent actions share.
 */
export function CynefinClient() {
  const hydrated = useWorkspaceHydrated();
  const items = useWorkspaceStore((s) => s.cynefinItems) ?? NO_ITEMS;
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  const { log } = useHistoryLogger("cynefin");
  const announce = useAnnounce();
  const [formOpen, setFormOpen] = useState(true);
  const hypotheses = useMemo(
    () => trackers.find((t) => t.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [],
    [trackers]
  );
  const grouped = useMemo(() => groupByDomain(items), [items]);
  const verdict = cynefinVerdict(items, hypotheses);
  const stateOf = (it: CynefinItem) => hypothesisStateOf(it, hypotheses);

  // A delete, a change of domain (the card moves to another section) and
  // "Turn into a hypothesis" unmount the control that made them, so focus
  // moves to a control on screen once the board has re-rendered (an element
  // id), never to the page.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    document.getElementById(id)?.focus();
  });
  const placeRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const ws = () => useWorkspaceStore.getState();
  const current = (id: string) => (ws().cynefinItems ?? []).find((x) => x.id === id);
  const patch = (id: string, change: (it: CynefinItem) => CynefinItem) => {
    const it = current(id);
    if (it) ws().upsertCynefinItem(change(it));
  };
  // Example items aren't the team's history.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };

  const add = (values: NewCynefinItem) => {
    const item: CynefinItem = {
      id: `cynefin_${nanoid(8)}`,
      ...values,
      loggedAt: new Date().toISOString(),
    };
    ws().upsertCynefinItem(item);
    record(item.id, CYNEFIN_ACTIONS.ITEM_ADDED, { title: item.title, domain: item.domain });
    announce(`Placed “${item.title}” in ${DOMAINS[item.domain].label}`);
  };

  const reclassify = (it: CynefinItem, domain: CynefinDomain) => {
    if (domain === it.domain) return;
    focusNext.current = itemControlId("domain", it.id);
    // A plan written for the item survives; a copy of the old domain's
    // recipe follows the new domain instead.
    patch(it.id, (x) => {
      const next: CynefinItem = { ...x, domain };
      if (!planOf(x).custom) delete next.recommendedAction;
      return next;
    });
    record(it.id, CYNEFIN_ACTIONS.ITEM_RECLASSIFIED, { id: it.id, domain });
    announce(`Moved “${it.title}” to ${DOMAINS[domain].label}`);
  };

  const remove = (it: CynefinItem) => {
    // Focus goes to the next item's delete button on the board (or the one
    // before); with none left, to the form for the next problem.
    const board = DOMAIN_IDS.flatMap((d) => grouped[d]);
    const at = board.findIndex((x) => x.id === it.id);
    const neighbour = board[at + 1] ?? board[at - 1];
    // The store unpins the item's canvas cards; Undo pins them back.
    const cards = cardLinksTo(it.id);
    if (neighbour) focusNext.current = itemControlId("delete", neighbour.id);
    undoable({
      label: `Deleted “${it.title}”`,
      apply: () => {
        ws().removeCynefinItem(it.id);
        record(it.id, CYNEFIN_ACTIONS.ITEM_REMOVED, { id: it.id });
      },
      revert: () => {
        ws().upsertCynefinItem(it);
        repinCards(cards);
      },
    });
    if (!neighbour) {
      (placeRef.current?.querySelector<HTMLInputElement>("input") ?? toggleRef.current)?.focus();
    }
    announce(`Deleted “${it.title}”`);
  };

  const toHypothesis = (it: CynefinItem) => {
    // The button gives way to the link to the hypothesis: focus goes there.
    focusNext.current = itemControlId("hypothesis", it.id);
    const link = sendHandoff("hypothesis", hypothesisSourceOf(it), {
      getLinks: () => current(it.id)?.sentTo,
      setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) =>
        patch(it.id, (x) => ({ ...x, sentTo: update(x.sentTo) })),
    });
    if (link) announce(`“${it.title}” is now a hypothesis to test`);
  };

  const loadExample = () => {
    const now = new Date().toISOString();
    buildExample(now).forEach((x) => ws().upsertCynefinItem(x));
  };
  const clearExample = () => {
    for (const it of items) if (isExampleId(it.id)) ws().removeCynefinItem(it.id);
  };

  const markdown = cynefinToMarkdown(items, { verdict, hypothesisOf: stateOf });
  const csvData = {
    headers: ["Title", "Domain", "Rationale", "Plan", "Hypothesis"],
    rows: items.map((it) => [
      it.title,
      it.domain,
      it.rationale ?? "",
      planOf(it).text,
      { none: "", testing: "being tested", tested: "tested" }[stateOf(it)],
    ]),
  };
  const promptConfig = useMemo(
    () => ({
      toolName: "Cynefin Decision Picker",
      // Suggested vs confirmed domains and the hypotheses' state, as the board shows them.
      prompts: generateCynefinPrompts({ items, hypotheses }),
    }),
    [items, hypotheses]
  );

  return (
    <ToolPageWrapper
      toolId="cynefin"
      title="Cynefin Decision Picker"
      description="Snowden's framework: answer a few questions to see which domain a problem is in (Clear, Complicated, Complex, Chaotic or Confused), confirm it, and act the way that domain needs."
    >
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the board…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExampleItems(items) && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: a product team&apos;s board, one problem per domain. Example items stay out
                of the Hypothesis Tracker.
              </p>
            </div>
          )}

          <SectionCard
            title="Place a problem"
            icon={Plus}
            actions={
              <button
                ref={toggleRef}
                type="button"
                aria-expanded={formOpen}
                onClick={() => setFormOpen((o) => !o)}
                className="min-touch-coarse rounded text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {formOpen ? "Hide" : "Show"}
              </button>
            }
          >
            <div ref={placeRef}>{formOpen && <SenseForm onSave={add} />}</div>
          </SectionCard>

          {items.length === 0 ? (
            <EmptyState
              icon={Compass}
              action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
            >
              No problems placed yet. Describe one above and answer the questions for a suggested
              domain, or load an example board.
            </EmptyState>
          ) : (
            <SectionCard
              title={`Board (${items.length})`}
              icon={Compass}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="cynefin"
                    markdown={markdown}
                    clipboardText={markdown}
                    csvData={csvData}
                    jsonData={items}
                  />
                </>
              }
            >
              <p className="mb-3 text-sm font-medium text-text">{verdict}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {DOMAIN_IDS.map((d) => (
                  <section
                    key={d}
                    aria-label={`${DOMAINS[d].label}: ${grouped[d].length}`}
                    className="min-w-0 rounded border border-border bg-card p-3"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <h2 className={`font-bold uppercase ${DOMAIN_TONE[d]}`}>
                        {DOMAINS[d].label}
                      </h2>
                      <span className="text-xs text-sub">{grouped[d].length}</span>
                    </div>
                    <p className="mb-2 text-xs italic text-sub">{DOMAINS[d].recipe}</p>
                    {grouped[d].length === 0 ? (
                      <p className="text-xs text-sub">Nothing here.</p>
                    ) : (
                      <ul className="space-y-2">
                        {grouped[d].map((it) => (
                          <ItemCard
                            key={it.id}
                            item={it}
                            hypothesis={stateOf(it)}
                            onTitle={(title) => patch(it.id, (x) => ({ ...x, title }))}
                            onRationale={(rationale) =>
                              patch(it.id, (x) => {
                                const next: CynefinItem = { ...x, rationale };
                                if (!rationale) delete next.rationale;
                                return next;
                              })
                            }
                            onDomain={(domain) => reclassify(it, domain)}
                            onHypothesis={() => toHypothesis(it)}
                            onDelete={() => remove(it)}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
