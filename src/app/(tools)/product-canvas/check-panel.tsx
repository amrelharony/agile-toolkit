"use client";

/**
 * The Check panel: what the canvas still lacks, always on screen, from the
 * page's own rules (no AI). "Ask Amr what's missing" adds the AI's view;
 * with no AI, "Check without AI" offers the same rules' findings. A gap the
 * person keeps becomes an Open question, with Undo.
 */

import { useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { SectionCard } from "@/components/shared/section-card";
import type { AiSource } from "@/lib/ai/task-types";
import {
  fitGapsInput,
  gapsInputFor,
  productCanvasGapsTask,
  type CanvasGapsOutput,
} from "@/lib/ai/tasks/product-canvas.lite";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { QUESTIONS_SECTION, sectionDef } from "@/lib/product-canvas/formats";
import {
  canvasGaps,
  formatOf,
  withItem,
  withoutItem,
  type GapContext,
} from "@/lib/product-canvas/model";
import { cutText } from "@/lib/utils/cut-text";
import { undoable } from "@/lib/utils/undoable";
import type { CanvasHandle } from "./boxes";

type Gap = CanvasGapsOutput["gaps"][number];

export function CheckPanel({ handle, context }: { handle: CanvasHandle; context: GapContext }) {
  const { canvas, read, write, log } = handle;
  const format = formatOf(canvas);
  const gaps = canvasGaps(canvas, context);
  const [found, setFound] = useState<{ gaps: Gap[]; source: AiSource } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const buttonWrap = useRef<HTMLDivElement>(null);
  const label = (sectionId: string | undefined) =>
    sectionId ? sectionDef(format, sectionId)?.label : undefined;

  const keep = (gap: Gap) => {
    const cur = read();
    if (!cur) return;
    const text = cutText(gap.text.replace(/\s+/g, " ").trim(), 200);
    const next = withItem(cur, QUESTIONS_SECTION, { text }, new Date().toISOString());
    if (!next.ok) {
      setProblem(next.message);
      return;
    }
    setProblem(null);
    const itemId = next.ids?.[0];
    undoable({
      label: "Added to the open questions",
      kind: "success",
      apply: () => {
        write(() => next);
        log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
          canvasId: canvas.id,
          section: QUESTIONS_SECTION,
        });
      },
      revert: () => {
        if (itemId) write((c, now) => withoutItem(c, itemId, now));
      },
    });
  };

  return (
    <SectionCard title="Check" icon={ListChecks} contentClassName="space-y-3">
      {gaps.length === 0 ? (
        <p role="status" className="text-sm text-sub">
          Nothing missing by the page’s checks. Ask Amr for a second look.
        </p>
      ) : (
        <ul
          aria-label="What the canvas still lacks"
          className="list-disc space-y-1 pl-5 text-sm text-text"
        >
          {gaps.map((g, i) => (
            <li key={`${g.sectionId ?? ""}:${i}`} className="break-words">
              {g.text}
            </li>
          ))}
        </ul>
      )}
      <div ref={buttonWrap} className="flex flex-wrap items-center gap-2">
        <AiButton
          task={productCanvasGapsTask}
          label="Ask Amr what's missing"
          fallbackLabel="Check without AI"
          variant="outline"
          input={() => fitGapsInput(gapsInputFor(read() ?? canvas, context))}
          onResult={(data, meta) => {
            setProblem(null);
            setFound({
              // A box the format doesn't have makes it a gap about the whole canvas.
              gaps: data.gaps.map((g) =>
                g.section && sectionDef(format, g.section) ? g : { text: g.text }
              ),
              source: meta.source,
            });
          }}
        />
      </div>
      {found && found.gaps.length === 0 && (
        <p role="status" className="text-sm text-sub">
          Amr found nothing more to ask.
        </p>
      )}
      {found && found.gaps.length > 0 && (
        <AiSuggestions<Gap>
          items={found.gaps}
          source={found.source}
          title="What to ask next"
          acceptLabel="Keep as a question"
          render={(g) => ({
            title: g.text,
            ...(label(g.section) ? { detail: label(g.section) } : {}),
          })}
          onAccept={keep}
          onDismiss={() => setFound(null)}
          returnFocus={() => buttonWrap.current?.querySelector<HTMLButtonElement>("button") ?? null}
        />
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </SectionCard>
  );
}
