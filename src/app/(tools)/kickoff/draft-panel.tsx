"use client";

/**
 * Ask Amr to draft a kickoff: lines for its sections from its name and
 * brief, with the Product Goal and the vision as context (never a name: no
 * participant, owner or person on the team). With no AI, "Draft without
 * AI" offers the brief's first sentence and each section's starter line
 * with [brackets] to fill in, and a few more trade-offs to order.
 *
 * Nothing lands on its own: the lines come in one list (add one, all or
 * none), each with its section; a section that is full (a single answer
 * that holds one) gets none, and a line says how many didn't fit. Every
 * accept has Undo.
 */

import { useRef, useState } from "react";
import { AiButton, AiSuggestions } from "@/components/ai";
import type { AiSource } from "@/lib/ai/task-types";
import {
  kickoffDraftInputFor,
  kickoffDraftTask,
  type KickoffDraftContext,
} from "@/lib/ai/tasks/kickoff.lite";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import { kickoffSection } from "@/lib/kickoff/formats";
import {
  draftFormatOf,
  draftItemsFor,
  draftSlidersFor,
  formatOf,
  itemsOf,
  orderedSliders,
  withDraftLines,
  withSlider,
} from "@/lib/kickoff/model";
import { removeDraftLines, roomLeft, type AddedLine } from "@/lib/sectioned/model";
import { TOOL_LIST_MAX, type Kickoff } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import type { KickoffHandle } from "./kickoff-handle";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One drafted line for a section, or one more trade-off. */
export type DraftOfferItem =
  | { kind: "line"; sectionId: string; text: string }
  | { kind: "slider"; label: string };

/** Whether a draft has anywhere to go: a section with room, or room for a slider. */
export function draftRoom(k: Kickoff): boolean {
  const format = formatOf(k);
  const sections = draftFormatOf(format).sections.some((d) => roomLeft(d, itemsOf(k, d.id)) > 0);
  const sliders = format.hasSliders && (k.sliders?.length ?? 0) < TOOL_LIST_MAX.kickoffSliders;
  return sections || sliders;
}

export function DraftPanel({
  handle,
  context,
}: {
  handle: KickoffHandle;
  context: KickoffDraftContext;
}) {
  const { kickoff: k, read, write, log } = handle;
  const format = formatOf(k);
  const [offer, setOffer] = useState<{
    items: DraftOfferItem[];
    dropped: number;
    source: AiSource;
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const buttonWrap = useRef<HTMLDivElement>(null);
  const label = (sectionId: string) => kickoffSection(format, sectionId)?.label ?? sectionId;
  const source = (s: AiSource) => (s === "ai" ? "ai" : "starter");

  const accept = (picked: DraftOfferItem[]) => {
    if (!offer || picked.length === 0) return;
    const cur = read();
    if (!cur) return;
    const lines = picked.flatMap((p) =>
      p.kind === "line" ? [{ sectionId: p.sectionId, text: p.text }] : []
    );
    const labels = picked.flatMap((p) => (p.kind === "slider" ? [p.label] : []));
    const now = new Date().toISOString();
    const drafted = withDraftLines(cur, lines, now);
    let next = drafted.kickoff;
    const sliderIds: string[] = [];
    let skipped = drafted.skipped;
    for (const label of labels) {
      const sliders = withSlider(orderedSliders(next), label);
      if (!sliders) {
        skipped++;
        continue;
      }
      sliderIds.push(sliders[sliders.length - 1].id);
      next = { ...next, sliders, updatedAt: now };
    }
    const added: AddedLine[] = drafted.added;
    const count = added.length + sliderIds.length;
    setNote(skipped > 0 ? `${plural(skipped, "line")} didn't fit.` : null);
    if (count === 0) return;
    const saved = next;
    undoable({
      label: `Added ${plural(count, "drafted line")}`,
      kind: "success",
      apply: () => {
        const w = write(() => saved);
        if (!w.ok) {
          setNote(w.message);
          return;
        }
        log(KICKOFF_ACTIONS.ITEMS_DRAFTED, {
          kickoffId: k.id,
          source: source(offer.source),
          count,
        });
      },
      revert: () => {
        const drop = new Set(sliderIds);
        write((c, at) => {
          const sliders = orderedSliders(c)
            .filter((s) => !drop.has(s.id))
            .map((s, i) => ({ ...s, position: i + 1 }));
          return {
            ...c,
            sections: removeDraftLines(c.sections, added),
            ...(format.hasSliders ? { sliders } : {}),
            updatedAt: at,
          };
        });
      },
    });
  };

  const returnFocus = () => buttonWrap.current?.querySelector<HTMLButtonElement>("button") ?? null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-sub">
        Amr suggests lines from the kickoff&apos;s name and brief. Nothing is added until you accept
        it.
      </p>
      <div ref={buttonWrap} className="flex flex-wrap items-center gap-2">
        <AiButton
          task={kickoffDraftTask}
          label="Ask Amr to draft"
          fallbackLabel="Draft without AI"
          disabledReason={draftRoom(k) ? null : "Every section is full."}
          input={() => kickoffDraftInputFor(read() ?? k, context)}
          onResult={(data, meta) => {
            const cur = read() ?? k;
            const { lines, dropped } = draftItemsFor(format, data.items, cur);
            const sliders = format.hasSliders ? draftSlidersFor(cur, data.sliders ?? []) : [];
            setNote(null);
            setOffer({
              items: [
                ...lines.map((l) => ({ kind: "line" as const, ...l })),
                ...sliders.map((label) => ({ kind: "slider" as const, label })),
              ],
              dropped,
              source: meta.source,
            });
          }}
        />
      </div>
      {offer && offer.items.length === 0 && (
        <p role="status" className="text-sm text-sub">
          Nothing new to add: the sections already hold these lines, or have no room.
        </p>
      )}
      {offer && offer.dropped > 0 && (
        <p className="text-sm text-sub">
          {plural(offer.dropped, "drafted line")} didn&apos;t fit the sections and{" "}
          {offer.dropped === 1 ? "was" : "were"} left out.
        </p>
      )}
      {offer && offer.items.length > 0 && (
        <AiSuggestions<DraftOfferItem>
          items={offer.items}
          source={offer.source}
          title="Amr's draft"
          render={(item) =>
            item.kind === "line"
              ? { title: item.text, detail: label(item.sectionId) }
              : { title: item.label, detail: "Trade-off" }
          }
          itemKey={(item) =>
            item.kind === "line"
              ? `${item.sectionId}\u0000${item.text}`
              : `slider\u0000${item.label}`
          }
          onAccept={(item) => accept([item])}
          onAcceptAll={(items) => accept(items)}
          onDismiss={() => setOffer(null)}
          returnFocus={returnFocus}
        />
      )}
      {note && (
        <p role="status" className="text-sm text-sub">
          {note}
        </p>
      )}
    </div>
  );
}
