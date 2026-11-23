"use client";

/**
 * The Lean UX canvas's own panel: build a hypothesis from one outcome, one
 * user, one benefit and one solution. The sentence is our own shape, shown
 * as it will be added; the hypothesis keeps its four picks as links, so its
 * learn-first line and its smallest test can link to it, and its send to
 * the Hypothesis Tracker carries them.
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { sectionDef } from "@/lib/product-canvas/formats";
import {
  HYPOTHESIS_PARTS,
  ITEM_MAX,
  formatOf,
  hypothesisSentence,
  itemsOf,
  withHypothesis,
  type HypothesisPart,
} from "@/lib/product-canvas/model";
import { shortText, type CanvasHandle } from "../boxes";

const PART_LABEL: Record<HypothesisPart, string> = {
  outcomes: "Outcome",
  users: "User",
  benefits: "Benefit",
  solutions: "Solution",
};

/** The builder's order: what you want, for whom, what they get, how. */
const ORDER: readonly HypothesisPart[] = ["outcomes", "users", "benefits", "solutions"];

const CHIP =
  "min-touch-coarse inline-flex max-w-full items-center rounded-md border border-border px-2 py-1 text-xs text-sub transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent";

export function HypothesesPanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, write, log } = handle;
  const format = formatOf(canvas);
  const [picks, setPicks] = useState<Partial<Record<HypothesisPart, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const lines = (part: HypothesisPart) => itemsOf(canvas, part).filter((i) => i.text.trim());
  const picked = (part: HypothesisPart) => lines(part).find((i) => i.id === picks[part]);
  const missing = ORDER.filter((p) => lines(p).length === 0);
  const all = HYPOTHESIS_PARTS.every((p) => picked(p));
  const preview = all
    ? hypothesisSentence({
        users: picked("users")!.text,
        benefit: picked("benefits")!.text,
        solution: picked("solutions")!.text,
        outcome: picked("outcomes")!.text,
      })
    : "";

  const add = () => {
    setDone(null);
    if (!all) {
      setProblem("Pick one outcome, one user, one benefit and one solution.");
      return;
    }
    const w = write((c, now) => withHypothesis(c, picks as Record<HypothesisPart, string>, now));
    if (!w.ok) {
      setProblem(w.message);
      return;
    }
    setProblem(null);
    setPicks({});
    setDone("Added to the hypotheses. Link a learn-first line and a smallest test to it.");
    log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, section: "hypotheses" });
  };

  return (
    <SectionCard title="Build a hypothesis" contentClassName="space-y-3">
      {missing.length > 0 ? (
        <p className="text-sm text-sub">
          Add at least one line to{" "}
          {missing.map((p) => `“${sectionDef(format, p)?.label ?? p}”`).join(", ")} first.
        </p>
      ) : (
        <>
          {ORDER.map((part) => (
            <fieldset key={part} className="space-y-1">
              <legend className="text-xs font-medium text-text">{PART_LABEL[part]}</legend>
              <div className="flex flex-wrap gap-1.5">
                {lines(part).map((item) => (
                  <label key={item.id} className="relative inline-flex max-w-full cursor-pointer">
                    <input
                      type="radio"
                      name={`pc-hyp-${canvas.id}-${part}`}
                      value={item.id}
                      checked={picks[part] === item.id}
                      onChange={() => {
                        setPicks((p) => ({ ...p, [part]: item.id }));
                        setProblem(null);
                        setDone(null);
                      }}
                      className="peer sr-only"
                    />
                    <span className={`${CHIP} truncate`}>{shortText(item.text, 60)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {preview && (
            <p className="text-sm text-text" data-field="hypothesis-preview">
              {preview}
              {preview.length > ITEM_MAX && (
                <span className="block text-xs text-danger">
                  It runs over {ITEM_MAX} characters: pick shorter parts, or shorten one.
                </span>
              )}
            </p>
          )}
          <Button type="button" size="sm" variant="toolkit" onClick={add}>
            <Plus aria-hidden="true" />
            Add the hypothesis
          </Button>
        </>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-sub">
          {done}
        </p>
      )}
    </SectionCard>
  );
}
