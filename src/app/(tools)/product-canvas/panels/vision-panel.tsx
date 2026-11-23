"use client";

/**
 * The Vision Board's own panel: the pitch, written live from its six boxes
 * in our own sentence shape, with Copy and a note when it leans on jargon;
 * and the vision copied either way with the Product Goal page, each copy
 * with Undo. The two visions stay apart unless someone copies one.
 */

import { useEffect } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { isExampleId } from "@/lib/utils/example-id";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { answerOf, jargonIn, pitchOf, pitchSentence, withText } from "@/lib/product-canvas/model";
import { undoable } from "@/lib/utils/undoable";
import type { CanvasHandle } from "../boxes";

export function VisionPanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, write, log } = handle;
  const pitch = pitchSentence(pitchOf(canvas));
  const jargon = jargonIn(pitch);
  const boxVision = answerOf(canvas, "vision");
  const goalVision = useProductGoalPrefs((s) => s.vision).trim();
  const example = isExampleId(canvas.id);

  useEffect(() => {
    const { persist } = useProductGoalPrefs;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: no vision to copy */
    });
  }, []);

  const startFromGoal = () => {
    const text = goalVision;
    undoable({
      label: "Vision copied from the Product Goal page",
      kind: "success",
      apply: () => {
        const w = write((c, now) => withText(c, "vision", text, now));
        if (w.ok)
          log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, section: "vision" });
      },
      revert: () => {
        write((c, now) =>
          answerOf(c, "vision") === text
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
        </div>
      )}
    </SectionCard>
  );
}
