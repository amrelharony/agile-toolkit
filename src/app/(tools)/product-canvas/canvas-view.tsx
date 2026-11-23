"use client";

/**
 * One product canvas: its name, format and credit, the Product Goal it
 * serves, Ask Amr's draft, its boxes laid out for the format, the format's
 * own panel, the Open questions and the Check panel.
 *
 * Phone first: every layout is one column at 375 px, a Value Proposition's
 * customer side above its offer side. The format's own panel loads with
 * the canvas that needs it (next/dynamic), not with the page.
 */

import { forwardRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Trash2 } from "lucide-react";
import { ProductGoalLine } from "@/components/product-goal/product-goal-line";
import { BlurInput } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
import { SectionCreditLine } from "@/components/sectioned/section-credit";
import { Button } from "@/components/ui/button";
import type { DraftContext } from "@/lib/ai/tasks/product-canvas.lite";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import {
  QUESTIONS_SECTION,
  sectionDef,
  type ProductSectionDef,
} from "@/lib/product-canvas/formats";
import { TITLE_MAX, formatOf, withTitle, type GapContext } from "@/lib/product-canvas/model";
import type { ProductGoal } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { CanvasBox, type CanvasHandle } from "./boxes";
import { CheckPanel } from "./check-panel";
import { DraftPanel } from "./draft-panel";

const VisionPanel = dynamic(() => import("./panels/vision-panel").then((m) => m.VisionPanel), {
  ssr: false,
});
const FitPanel = dynamic(() => import("./panels/fit-panel").then((m) => m.FitPanel), {
  ssr: false,
});
const HypothesesPanel = dynamic(
  () => import("./panels/hypotheses-panel").then((m) => m.HypothesesPanel),
  { ssr: false }
);
const PressReleasePanel = dynamic(
  () => import("./panels/press-release-panel").then((m) => m.PressReleasePanel),
  { ssr: false }
);
const IntakePanel = dynamic(() => import("./panels/intake-panel").then((m) => m.IntakePanel), {
  ssr: false,
});
const DecisionPanel = dynamic(
  () => import("./panels/decision-panel").then((m) => m.DecisionPanel),
  { ssr: false }
);
const AppetitePanel = dynamic(
  () => import("./panels/appetite-panel").then((m) => m.AppetitePanel),
  { ssr: false }
);
const BetPanel = dynamic(() => import("./panels/bet-panel").then((m) => m.BetPanel), {
  ssr: false,
});

/** Each group's heading on the page. */
const GROUP_TITLE: Record<string, string> = {
  pitch: "Elevator pitch",
  customer: "The customer",
  offer: "What we offer",
  release: "Press release",
  faq: "Questions and answers",
  tests: "Hypotheses and tests",
  scope: "Scope",
  costs: "Start small, and what it costs",
  limits: "Limits",
};

/** The format's boxes in runs of one group, the Open questions left for last. */
function runsOf(defs: readonly ProductSectionDef[]) {
  const runs: { group?: string; defs: ProductSectionDef[] }[] = [];
  for (const def of defs) {
    if (def.id === QUESTIONS_SECTION) continue;
    const last = runs[runs.length - 1];
    if (last && last.group === def.group) last.defs.push(def);
    else runs.push({ group: def.group, defs: [def] });
  }
  return runs;
}

function Run({
  handle,
  group,
  defs,
  oneColumn,
  before,
  after,
}: {
  handle: CanvasHandle;
  group?: string;
  defs: readonly ProductSectionDef[];
  oneColumn?: boolean;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const id = `pc-group-${handle.canvas.id}-${group ?? "main"}`;
  const title = group ? GROUP_TITLE[group] : undefined;
  return (
    <section aria-labelledby={title ? id : undefined} className="space-y-3">
      {title && (
        <h3 id={id} className="font-display text-base text-text">
          {title}
        </h3>
      )}
      {before}
      <div className={cn("grid gap-4", !oneColumn && "md:grid-cols-2")}>
        {defs.map((def) => (
          <CanvasBox
            key={`${handle.canvas.id}:${def.id}`}
            handle={handle}
            def={def}
            className={def.kind === "long" && !oneColumn ? "md:col-span-2" : undefined}
          />
        ))}
      </div>
      {after}
    </section>
  );
}

export interface CanvasViewProps {
  handle: CanvasHandle;
  /** The goal line's goal: the active one, or the example's on an example canvas. */
  goal: ProductGoal | undefined;
  draftContext: Omit<DraftContext, "brief">;
  gapContext: GapContext;
  onRemove: () => void;
  /** Show the betting table (a Shape Up pitch's link to it). */
  onOpenTable?: () => void;
}

export const CanvasView = forwardRef<HTMLSpanElement, CanvasViewProps>(function CanvasView(
  { handle, goal, draftContext, gapContext, onRemove, onOpenTable },
  headingRef
) {
  const { canvas, write, log } = handle;
  const format = formatOf(canvas);
  const example = isExampleId(canvas.id);
  const earlier = !example && canvas.productGoalId && canvas.productGoalId !== goal?.id;
  const runs = runsOf(format.sections);
  const questions = sectionDef(format, QUESTIONS_SECTION);

  const panelAfter = (group: string | undefined) => {
    if (canvas.format === "vision-board" && group === "pitch")
      return <VisionPanel handle={handle} />;
    if (canvas.format === "pr-faq" && group === "faq") return <PressReleasePanel handle={handle} />;
    if (canvas.format === "shape-up" && group === "problem")
      return <AppetitePanel handle={handle} />;
    return null;
  };
  /** The format's own panel before its boxes (an idea's intake) and after them (a decision, a bet). */
  const before =
    canvas.format === "idea" ? <IntakePanel key={`intake-${canvas.id}`} handle={handle} /> : null;
  const after =
    canvas.format === "business-case" ? (
      <DecisionPanel handle={handle} />
    ) : canvas.format === "shape-up" ? (
      <BetPanel handle={handle} onOpenTable={onOpenTable} />
    ) : null;

  const body =
    format.layout === "two-sides" ? (
      <>
        <div className="grid gap-6 lg:grid-cols-2">
          {runs.map((run) => (
            <Run
              key={run.group ?? "main"}
              handle={handle}
              group={run.group}
              defs={run.defs}
              oneColumn
            />
          ))}
        </div>
        <FitPanel handle={handle} />
      </>
    ) : (
      runs.map((run, i) => (
        <Run
          key={`${run.group ?? "main"}-${i}`}
          handle={handle}
          group={run.group}
          defs={run.defs}
          oneColumn={format.layout === "document" && run.group === "release"}
          before={
            canvas.format === "lean-ux" && run.group === "tests" ? (
              <HypothesesPanel handle={handle} />
            ) : undefined
          }
          after={panelAfter(run.group)}
        />
      ))
    );

  return (
    <SectionCard
      title={
        <span
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {canvas.title}
        </span>
      }
      titleSuffix={format.name}
      contentClassName="space-y-6"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0 basis-full space-y-1 sm:basis-0 sm:flex-1">
            <label htmlFor={`pc-title-${canvas.id}`} className="block text-xs font-medium text-sub">
              {canvas.format === "idea" ? "The idea" : "Canvas name"}
            </label>
            <BlurInput
              id={`pc-title-${canvas.id}`}
              value={canvas.title}
              maxLength={TITLE_MAX}
              className="font-semibold"
              onCommit={(text) => {
                if (!text.trim() || text.trim() === canvas.title) return;
                const w = write((c, now) => withTitle(c, text, now));
                if (w.ok)
                  log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
                    canvasId: canvas.id,
                    field: "title",
                  });
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="gap-1.5 text-sub hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {canvas.format === "idea" ? "Delete idea" : "Delete canvas"}
          </Button>
        </div>
        <SectionCreditLine credit={format.credit} />
        <ProductGoalLine goal={goal}>
          {earlier ? (
            <p className="text-xs text-sub">Drafted for an earlier Product Goal.</p>
          ) : example ? (
            <p className="text-xs text-sub">The example’s Product Goal, not yours.</p>
          ) : null}
        </ProductGoalLine>
      </div>

      {before}

      <SectionCard title="Draft with Amr" titleSize="sm">
        <DraftPanel handle={handle} context={draftContext} />
      </SectionCard>

      {body}

      {after}

      {questions && (
        <CanvasBox key={`${canvas.id}:${questions.id}`} handle={handle} def={questions} />
      )}

      <CheckPanel handle={handle} context={gapContext} />
    </SectionCard>
  );
});
