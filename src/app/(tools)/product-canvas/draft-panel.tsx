"use client";

/**
 * Ask Amr to draft a canvas: from the Product Goal, the vision, a short
 * brief (typed here, never saved) and the backlog's titles. With no AI,
 * "Suggest without AI" offers the goal's own words and starter lines with
 * [brackets] to fill in.
 *
 * Nothing lands on its own. New lines and empty boxes come in one list (add
 * one, all or none); another wording for a box that already holds text
 * comes in a second list, one at a time, as "Replace", so "all" can never
 * overwrite what someone typed. Every accept has Undo, and a drafted line in
 * a fact-or-guess box arrives marked a guess.
 */

import { useRef, useState } from "react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AiSource } from "@/lib/ai/task-types";
import {
  draftInputFor,
  fitDraftInput,
  productCanvasDraftTask,
  type DraftContext,
} from "@/lib/ai/tasks/product-canvas.lite";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { sectionDef } from "@/lib/product-canvas/formats";
import {
  answerOf,
  formatOf,
  withDraftLines,
  withSections,
  withText,
} from "@/lib/product-canvas/model";
import {
  DRAFT_BRIEF_MAX,
  draftDisabledReason,
  draftOffer,
  type DraftOffer,
  type OfferLine,
  type OfferReplace,
} from "@/lib/product-canvas/starter";
import { removeDraftLines } from "@/lib/sectioned/model";
import { undoable } from "@/lib/utils/undoable";
import { shortText, type CanvasHandle } from "./boxes";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DraftPanel({
  handle,
  context,
}: {
  handle: CanvasHandle;
  /** What the draft starts from: the team's goal, vision and backlog, or the example's. */
  context: Omit<DraftContext, "brief">;
}) {
  const { canvas, read, write, log } = handle;
  const format = formatOf(canvas);
  const [brief, setBrief] = useState("");
  const [offer, setOffer] = useState<(DraftOffer & { source: AiSource }) | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const buttonWrap = useRef<HTMLDivElement>(null);
  const label = (sectionId: string) => sectionDef(format, sectionId)?.label ?? sectionId;
  const source = (s: AiSource) => (s === "ai" ? "ai" : "starter");

  const input = () => fitDraftInput(draftInputFor(canvas, { ...context, brief }));
  const disabledReason = draftDisabledReason(draftInputFor(canvas, { ...context, brief }));

  const accept = (lines: OfferLine[]) => {
    if (!offer) return;
    const cur = read();
    if (!cur || lines.length === 0) return;
    const result = withDraftLines(cur, lines, new Date().toISOString());
    if (!result.write.ok) {
      setNote(result.write.message);
      return;
    }
    const { added, skipped } = result;
    const saved = result.write.canvas;
    setNote(skipped > 0 ? `${plural(skipped, "line")} didn't fit.` : null);
    if (added.length === 0) return;
    undoable({
      label: `Added ${plural(added.length, "drafted line")}`,
      kind: "success",
      apply: () => {
        write(() => ({ ok: true, canvas: saved }));
        log(PRODUCT_CANVAS_ACTIONS.DRAFT_ACCEPTED, {
          canvasId: canvas.id,
          source: source(offer.source),
          count: added.length,
        });
      },
      revert: () => {
        write((c, now) => withSections(c, removeDraftLines(c.sections, added), now));
      },
    });
  };

  const replace = (r: OfferReplace) => {
    if (!offer) return;
    const cur = read();
    if (!cur) return;
    const was = answerOf(cur, r.sectionId);
    const next = withText(cur, r.sectionId, r.text, new Date().toISOString());
    if (!next.ok) {
      setNote(next.message);
      return;
    }
    undoable({
      label: `Replaced “${shortText(label(r.sectionId), 40)}”`,
      kind: "success",
      apply: () => {
        write(() => next);
        log(PRODUCT_CANVAS_ACTIONS.DRAFT_ACCEPTED, {
          canvasId: canvas.id,
          source: source(offer.source),
          count: 1,
        });
      },
      revert: () => {
        write((c, now) =>
          answerOf(c, r.sectionId) === r.text.trim()
            ? withText(c, r.sectionId, was || null, now)
            : { ok: true, canvas: c }
        );
      },
    });
    setOffer((o) => (o ? { ...o, replaces: o.replaces.filter((x) => x !== r) } : o));
  };

  const returnFocus = () => buttonWrap.current?.querySelector<HTMLButtonElement>("button") ?? null;

  return (
    <div className="space-y-3">
      <Field
        label="A short brief for Amr"
        hint="What the canvas is about, in a sentence or two. It isn't saved."
      >
        {(props) => (
          <Input
            {...props}
            value={brief}
            maxLength={DRAFT_BRIEF_MAX}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Stall holders lose sales when a buyer has no cash"
          />
        )}
      </Field>
      <div ref={buttonWrap} className="flex flex-wrap items-center gap-2">
        <AiButton
          task={productCanvasDraftTask}
          label="Ask Amr to draft"
          fallbackLabel="Suggest without AI"
          disabledReason={disabledReason}
          input={input}
          onResult={(data, meta) => {
            const cur = read() ?? canvas;
            setNote(null);
            setOffer({ ...draftOffer(cur, data), source: meta.source });
          }}
        />
      </div>
      {offer && offer.lines.length === 0 && offer.replaces.length === 0 && (
        <p role="status" className="text-sm text-sub">
          Nothing new to add: every box the draft could fill already has these lines.
        </p>
      )}
      {offer && offer.dropped > 0 && (
        <p className="text-sm text-sub">
          {plural(offer.dropped, "drafted line")} didn’t fit the boxes and were left out.
        </p>
      )}
      {offer && offer.lines.length > 0 && (
        <AiSuggestions<OfferLine>
          items={offer.lines}
          source={offer.source}
          title="Amr's draft"
          render={(l) => ({
            title: l.text,
            detail: [label(l.sectionId), l.detail ? `Answer: ${l.detail}` : ""]
              .filter(Boolean)
              .join(" · "),
          })}
          itemKey={(l) => `${l.sectionId}\u0000${l.text}`}
          onAccept={(l) => accept([l])}
          onAcceptAll={(ls) => accept(ls)}
          onDismiss={() => setOffer((o) => (o ? { ...o, lines: [] } : o))}
          returnFocus={returnFocus}
        />
      )}
      {offer && offer.replaces.length > 0 && (
        <AiSuggestions<OfferReplace>
          items={offer.replaces}
          source={offer.source}
          title="Other wording for boxes you filled"
          acceptLabel="Replace"
          pickOne
          render={(r) => ({
            title: r.text,
            detail: `${label(r.sectionId)}. Now: ${shortText(r.current, 80)}`,
          })}
          itemKey={(r) => `${r.sectionId}\u0000${r.text}`}
          onAccept={replace}
          onDismiss={() => setOffer((o) => (o ? { ...o, replaces: [] } : o))}
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
