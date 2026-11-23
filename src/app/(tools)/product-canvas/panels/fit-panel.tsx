"use client";

/**
 * The Value Proposition's own panel: how well the offer side meets the
 * customer side. A pain counts as eased, and a gain as added, when a line on
 * the offer side links to it. A fit is known only when customers say so:
 * a pain marked a fact, or a guess that held in the Hypothesis Tracker.
 */

import { SectionCard } from "@/components/shared/section-card";
import { FIT_NOTE, fitMeter, itemsOf } from "@/lib/product-canvas/model";
import { shortText, type CanvasHandle } from "../boxes";

export function FitPanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, hypotheses } = handle;
  const m = fitMeter(canvas, hypotheses);
  const pains = itemsOf(canvas, "pains");
  const uneased = pains.filter((p) => m.uneased.includes(p.id));
  return (
    <SectionCard title="Fit" contentClassName="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-sub">Pains eased</dt>
          <dd className="font-display text-lg text-text">
            {m.pains.eased} of {m.pains.total}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-sub">Gains added</dt>
          <dd className="font-display text-lg text-text">
            {m.gains.added} of {m.gains.total}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-sub">Eased and known</dt>
          <dd className="font-display text-lg text-text">{m.confirmed}</dd>
        </div>
        <div>
          <dt className="text-xs text-sub">Offer lines linked to nothing</dt>
          <dd className="font-display text-lg text-text">{m.idle}</dd>
        </div>
      </dl>
      <p className="text-sm text-sub">{FIT_NOTE}</p>
      {uneased.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-text">Nothing eases yet:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-sub">
            {uneased.map((p) => (
              <li key={p.id} className="break-words">
                {shortText(p.text, 120)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
