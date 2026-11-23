"use client";

/**
 * The Vision Board's own panel: the pitch, written live from its six boxes
 * in our own sentence shape, with Copy and a note when it leans on jargon;
 * and the vision copied either way with the Product Goal page, each copy
 * with Undo. The two visions stay apart unless someone copies one. The
 * goal's vision comes over as the one-line box holds it (one line, cut to
 * ITEM_MAX, with a note when cut), and a copy the box refuses says why.
 */

import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cutText } from "@/lib/utils/cut-text";
import { isExampleId } from "@/lib/utils/example-id";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import {
  ITEM_MAX,
  answerOf,
  jargonIn,
  oneLine,
  pitchOf,
  pitchSentence,
  withText,
} from "@/lib/product-canvas/model";
import { undoable } from "@/lib/utils/undoable";
import type { CanvasHandle } from "../boxes";

export function VisionPanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, read, write, log } = handle;
  const pitch = pitchSentence(pitchOf(canvas));
  const jargon = jargonIn(pitch);
  const boxVision = answerOf(canvas, "vision");
  // The Product Goal page's vision is a paragraph of up to 2,000
  // characters, and this box one line of ITEM_MAX: it is copied, compared
  // and undone as the box stores it.
  const goalLine = oneLine(useProductGoalPrefs((s) => s.vision));
  const goalVision = cutText(goalLine, ITEM_MAX).trim();
  const goalCut = goalVision.length < goalLine.length;
  const [note, setNote] = useState<string | null>(null);
  const example = isExampleId(canvas.id);

  useEffect(() => {
    const { persist } = useProductGoalPrefs;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: no vision to copy */
    });
  }, []);

  const startFromGoal = () => {
    const cur = read();
    if (!cur) return;
    const next = withText(cur, "vision", goalVision, new Date().toISOString());
    if (!next.ok) {
      setNote(next.message);
      return;
    }
    setNote(null);
    // What the box holds once copied: the Undo clears only that.
    const copied = answerOf(next.canvas, "vision");
    undoable({
      label: "Vision copied from the Product Goal page",
      kind: "success",
      apply: () => {
        const w = write(() => next);
        if (w.ok)
          log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, section: "vision" });
      },
      revert: () => {
        write((c, now) =>
          answerOf(c, "vision") === copied
            ? withText(c, "vision", null, now)
            : { ok: true, canvas: c }
        );
      },
    });
  };

  const useAsVision = () => {
    const was = useProductGoalPrefs.getState().vision;
    const text = boxVision;
    undoable({
      label: "Saved as the product vision",
      kind: "success",
      apply: () => useProductGoalPrefs.setState({ vision: text }),
      revert: () => {
        if (useProductGoalPrefs.getState().vision === text) {
          useProductGoalPrefs.setState({ vision: was });
        }
      },
    });
  };

  return (
    <SectionCard title="The pitch" contentClassName="space-y-3">
      {pitch ? (
        <>
          <p className="text-sm text-text" data-field="pitch">
            {pitch}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={pitch} label="Copy the pitch" announcement="Pitch copied" />
          </div>
          {jargon.length > 0 && (
            <p className="text-xs text-warning">
              It says “{jargon.join("”, “")}”. Read it aloud and say plainly what changes instead.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-sub">Fill in the pitch’s boxes and it writes itself here.</p>
      )}
      {!example && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-sub">
            The Product Goal page keeps a vision of its own. The two stay apart unless you copy one.
          </p>
          <div className="flex flex-wrap gap-2">
            {!boxVision && goalVision && (
              <Button type="button" size="sm" variant="outline" onClick={startFromGoal}>
                <ArrowDownToLine aria-hidden="true" />
                Start from the Product Goal’s vision
              </Button>
            )}
            {boxVision && boxVision !== goalVision && (
              <Button type="button" size="sm" variant="outline" onClick={useAsVision}>
                <ArrowUpFromLine aria-hidden="true" />
                Use as the product vision
              </Button>
            )}
          </div>
          {!boxVision && goalCut && (
            <p className="text-xs text-sub">
              The Product Goal’s vision is longer than this box holds ({ITEM_MAX} characters on one
              line), so only its start comes over.
            </p>
          )}
          {note && (
            <p role="status" className="text-sm text-sub">
              {note}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
