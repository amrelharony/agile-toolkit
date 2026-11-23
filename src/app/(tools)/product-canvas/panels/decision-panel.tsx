"use client";

/**
 * A lean business case's decision: the verdict (not decided yet, go, no go,
 * or change and come back), a note on why, and the day it was decided,
 * stamped when the verdict changes. "Record in the Decision Log" adds a
 * proposed record there: "Business case: {epic}", what we expect as its
 * context, the three options weighed and the verdict as the proposal; the
 * team accepts it in the log.
 *
 * A go is a milestone: it logs `case_approved` and Amr cheers, in the same
 * tick. Every other verdict logs `case_decided`. The example is never sent
 * nor logged.
 */

import { useState } from "react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
import { cheer } from "@/lib/celebrate/cheer";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { NOTE_MAX, VERDICT_LABEL, verdictOf } from "@/lib/product-canvas/fields";
import { withCanvasSentTo, withDecision } from "@/lib/product-canvas/model";
import { caseDecisionSource } from "@/lib/product-canvas/sends";
import type { HandoffLink } from "@/lib/handoffs/types";
import { PRODUCT_CASE_VERDICTS, type ProductCaseVerdict } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import type { CanvasHandle } from "../boxes";

const CHIP =
  "min-touch-coarse inline-flex items-center rounded-md border border-border px-2.5 py-1 text-sm text-sub transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent";

export function DecisionPanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, write, log } = handle;
  const [problem, setProblem] = useState<string | null>(null);
  const example = isExampleId(canvas.id);
  const verdict = verdictOf(canvas);
  const day = canvas.decision?.decidedAt?.slice(0, 10);
  const name = `pc-verdict-${canvas.id}`;

  const decide = (next: ProductCaseVerdict) => {
    if (next === verdict) return;
    const w = write((c, now) => withDecision(c, next, undefined, now));
    if (!w.ok) {
      setProblem(w.message);
      return;
    }
    setProblem(null);
    if (next === "go") {
      log(PRODUCT_CANVAS_ACTIONS.CASE_APPROVED, { canvasId: canvas.id });
      if (!example) cheer("product-canvas", "milestone");
    } else {
      log(PRODUCT_CANVAS_ACTIONS.CASE_DECIDED, { canvasId: canvas.id, verdict: next });
    }
  };

  const setLinks = (change: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
    let before: readonly HandoffLink[] | undefined;
    const w = write((c, now) => {
      before = c.sentTo;
      return withCanvasSentTo(c, change(c.sentTo), now);
    });
    if (!w.ok) return;
    const after = w.canvas.sentTo?.find((l) => l.route === "decision");
    if (after && !before?.some((b) => b.route === "decision" && b.targetId === after.targetId)) {
      log(PRODUCT_CANVAS_ACTIONS.ITEM_SENT, { canvasId: canvas.id, route: "decision" });
    }
  };

  return (
    <SectionCard title="Decision" contentClassName="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-text">The verdict</legend>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_CASE_VERDICTS.map((v) => (
            <label key={v} className="relative inline-flex cursor-pointer">
              <input
                type="radio"
                name={name}
                value={v}
                checked={verdict === v}
                onChange={() => decide(v)}
                className="peer sr-only"
              />
              <span className={CHIP}>{VERDICT_LABEL[v]}</span>
            </label>
          ))}
        </div>
        {verdict !== "pending" && day && (
          <p className="text-xs text-sub" data-field="decided-on">
            Decided on {day}.
          </p>
        )}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={`pc-verdict-note-${canvas.id}`} className="text-sm text-text">
          Why
        </label>
        <BlurTextarea
          id={`pc-verdict-note-${canvas.id}`}
          rows={2}
          value={canvas.decision?.note ?? ""}
          maxLength={NOTE_MAX}
          placeholder="What the decision rests on"
          onCommit={(text) => {
            if ((canvas.decision?.note ?? "") === text.trim()) return;
            const w = write((c, now) => withDecision(c, verdict, text.trim() || null, now));
            if (!w.ok) setProblem(w.message);
            else {
              setProblem(null);
              log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
                canvasId: canvas.id,
                field: "decision",
              });
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-sub">Record it in the Decision Log, where the team agrees it:</p>
        <SendToMenu
          routes={["decision"]}
          item={caseDecisionSource(canvas)}
          sentTo={canvas.sentTo}
          itemLabels={{ decision: "Record in the Decision Log" }}
          getLinks={() => handle.read()?.sentTo}
          onLinksChange={setLinks}
          disabled={example}
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </SectionCard>
  );
}
