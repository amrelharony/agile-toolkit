"use client";

import { useMemo, useRef, useState } from "react";
import Link from "@/components/motion/transition-link";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
} from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { generateWalkingSkeletonPrompts } from "@/lib/ai-prompts/walking-skeleton";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WALKING_SKELETON_ACTIONS } from "@/lib/history/event-actions";
import { plural } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { useWalkingSkeletonStore, type SkeletonData, type SkeletonStep } from "./store";
import {
  LAYERS,
  inBacklog,
  layerCoverage,
  layerInfo,
  moveStep,
  sendSteps,
  skeletonVerdict,
  stepsToSend,
  unsendSteps,
  withSentLinks,
  type SentStep,
} from "./skeleton";
import { StepAddForm, StepRowEditor, type StepValues } from "./step-form";
import { withExample, withoutExample } from "./example";
import { toMarkdown } from "./markdown";

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * After a move, keep focus on the moved step's arrow; at the top or bottom
 * that arrow is disabled, so focus its other one.
 */
function focusMoved(id: string, dir: "up" | "down") {
  requestAnimationFrame(() => {
    const find = (d: string) => byData("step-move", `${id}:${d}`) as HTMLButtonElement | undefined;
    const el = find(dir);
    (el && !el.disabled ? el : find(dir === "up" ? "down" : "up"))?.focus();
  });
}

/** The element whose `data-<name>` is `value`; ids go in no selector, so need no escaping. */
function byData(name: string, value: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-${name}]`)).find(
    (el) => el.getAttribute(`data-${name}`) === value
  );
}

/**
 * Focus what `find` returns once React has re-rendered. Closing an editor,
 * deleting a step or sending the last steps unmounts the focused control,
 * and focus would otherwise drop to <body>.
 */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

export function WalkingSkeletonClient() {
  const goal = useWalkingSkeletonStore((s) => s.goal);
  const steps = useWalkingSkeletonStore((s) => s.steps);
  const { setGoal, add, update, toggle, setSteps, replace } = useWalkingSkeletonStore.getState();
  // Subscribed so "In backlog" follows a story deleted from the backlog elsewhere.
  useWorkspaceStore((s) => s.stories);
  const { log } = useHistoryLogger("walking-skeleton");
  const exportRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // What a reset cleared, for its Undo.
  const cleared = useRef<SkeletonData | null>(null);

  const done = steps.filter((s) => s.done).length;
  const pct = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);
  const coverage = useMemo(() => layerCoverage(steps), [steps]);
  const toSend = stepsToSend(steps);
  const sentCount = steps.filter(inBacklog).length;

  function addStep(values: StepValues) {
    add(values.text, values.layer);
    log(WALKING_SKELETON_ACTIONS.STEP_ADDED, { layer: values.layer });
  }

  // Saved or cancelled, the editor closes: focus goes back to the step's Edit button.
  function closeEditor(step: SkeletonStep) {
    setEditingId(null);
    focusSoon(() => byData("step-edit", step.id));
  }

  function saveStep(step: SkeletonStep, values: StepValues) {
    closeEditor(step);
    if (step.text === values.text && step.layer === values.layer) return;
    update(step.id, values);
    log(WALKING_SKELETON_ACTIONS.STEP_UPDATED, { id: step.id, layer: values.layer });
  }

  function move(step: SkeletonStep, delta: -1 | 1) {
    setSteps((list) => moveStep(list, step.id, delta));
    log(WALKING_SKELETON_ACTIONS.STEP_MOVED, {
      id: step.id,
      direction: delta === -1 ? "up" : "down",
    });
    focusMoved(step.id, delta === -1 ? "up" : "down");
  }

  function remove(step: SkeletonStep) {
    // Focus moves on to the next step (else the previous one), or to the
    // Add step field once the path is empty.
    const list = useWalkingSkeletonStore.getState().steps;
    const at = list.findIndex((s) => s.id === step.id);
    const neighbour = at >= 0 ? (list[at + 1] ?? list[at - 1]) : undefined;
    removeWithUndo<SkeletonStep>({
      label: `Deleted “${shortName(step.text)}”`,
      update: setSteps,
      match: (s) => s.id === step.id,
    });
    log(WALKING_SKELETON_ACTIONS.STEP_REMOVED, { id: step.id });
    focusSoon(() =>
      neighbour
        ? byData("step-toggle", neighbour.id)
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  }

  // The steps not done become backlog stories, as one undoable batch.
  function sendToBacklog() {
    const batch = stepsToSend(useWalkingSkeletonStore.getState().steps);
    if (batch.length === 0) return;
    let sent: Map<string, SentStep> = new Map();
    undoable({
      label: `Added ${plural(batch.length, "story", "stories")} to the backlog`,
      description: "From the walking skeleton",
      apply: () => {
        sent = sendSteps(batch, new Date().toISOString());
        setSteps((list) => withSentLinks(list, sent, false));
      },
      revert: () => {
        unsendSteps(sent);
        setSteps((list) => withSentLinks(list, sent, true));
      },
    });
    // Every step on offer went, so the button gives way to the backlog link.
    focusSoon(() => document.querySelector<HTMLElement>("[data-step-backlog]"));
  }

  const hasExample = hasExampleItems(steps);
  const loadExample = () => replace(withExample({ goal, steps }));
  // Not logged: the example isn't the user's own work.
  const clearExample = () => replace(withoutExample(useWalkingSkeletonStore.getState()));

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Walking Skeleton",
      prompts: generateWalkingSkeletonPrompts({ goal, steps }, workspace),
    }),
    [goal, steps, workspace]
  );

  const csvData = {
    headers: ["#", "Step", "Layer", "Done"],
    rows: steps.map((s, i) => [i + 1, s.text, layerInfo(s.layer).label, s.done ? "yes" : "no"]),
  };

  return (
    <ToolPageWrapper
      toolId="walking-skeleton"
      title="Walking Skeleton Builder"
      description="Define the smallest end-to-end implementation that proves the architecture works (Cockburn). Walk one happy path through every layer."
    >
      <div ref={exportRef} className="space-y-4">
        {hasExample && <ExampleNotice onClear={clearExample} />}

        <SectionCard title="Goal">
          <BlurTextarea
            placeholder="What's the smallest end-to-end happy path you can ship?"
            aria-label="Walking skeleton goal"
            value={goal}
            onCommit={setGoal}
            rows={2}
          />
        </SectionCard>

        <SectionCard title="Add step" icon={Plus}>
          <div ref={addRef}>
            <StepAddForm onAdd={addStep} />
          </div>
        </SectionCard>

        {steps.length === 0 ? (
          <EmptyState
            icon={Boxes}
            action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
          >
            No steps yet. Add the thinnest path a request takes, in order, through the UI, API, data
            and infra layers, or load an example.
          </EmptyState>
        ) : (
          <SectionCard
            title={`End-to-end path (${plural(steps.length, "step")})`}
            icon={Boxes}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="walking-skeleton"
                  csvData={csvData}
                  jsonData={{ goal, steps }}
                  markdown={toMarkdown({ goal, steps })}
                  targetRef={exportRef}
                />
                <ResetButton
                  label="Clear"
                  title="Clear the walking skeleton?"
                  description={`Its goal and ${plural(steps.length, "step")} are removed. Stories already sent to the backlog stay there.`}
                  confirmLabel="Clear skeleton"
                  doneLabel="Cleared the walking skeleton"
                  onReset={() => {
                    cleared.current = { goal, steps };
                    replace({ goal: "", steps: [] });
                    log(WALKING_SKELETON_ACTIONS.SKELETON_RESET, {});
                  }}
                  onUndo={() => cleared.current && replace(cleared.current)}
                />
              </>
            }
          >
            <p className="text-sm font-medium text-text">{skeletonVerdict(steps)}</p>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded bg-surface-deep"
              aria-hidden="true"
            >
              <div className="h-2 bg-success" style={{ width: `${pct}%` }} />
            </div>

            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Layer coverage">
              {LAYERS.map((l) => {
                const n = coverage.counts[l.id];
                return (
                  <li
                    key={l.id}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs",
                      n > 0 ? l.tag : "border-dashed border-warning/60 text-warning"
                    )}
                  >
                    {n > 0 ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="h-3 w-3" aria-hidden="true" />
                    )}
                    {l.label}: {n > 0 ? plural(n, "step") : "not touched yet"}
                  </li>
                );
              })}
            </ul>

            <ol className="mt-3 divide-y divide-border" aria-label="Skeleton path, in order">
              {steps.map((s, i) => (
                <li key={s.id} className="py-2">
                  {editingId === s.id ? (
                    <StepRowEditor
                      step={s}
                      position={i + 1}
                      onSave={(values) => saveStep(s, values)}
                      onCancel={() => closeEditor(s)}
                    />
                  ) : (
                    <StepRow
                      step={s}
                      index={i}
                      count={steps.length}
                      onToggle={() => {
                        toggle(s.id);
                        log(WALKING_SKELETON_ACTIONS.STEP_TOGGLED, { id: s.id });
                      }}
                      onMove={(delta) => move(s, delta)}
                      onEdit={() => setEditingId(s.id)}
                      onRemove={() => remove(s)}
                    />
                  )}
                </li>
              ))}
            </ol>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {toSend.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={sendToBacklog}>
                  <Send aria-hidden="true" />
                  Send {plural(toSend.length, "step")} to backlog
                </Button>
              )}
              {sentCount > 0 && (
                <Link
                  href="/sprint-planning"
                  data-step-backlog
                  className="text-xs text-sub underline-offset-2 hover:text-accent hover:underline"
                >
                  {plural(sentCount, "step")} in the backlog · Open Sprint Planning
                </Link>
              )}
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

/** One step on the path: its place, done toggle, layer, and actions. */
function StepRow({
  step,
  index,
  count,
  onToggle,
  onMove,
  onEdit,
  onRemove,
}: {
  step: SkeletonStep;
  index: number;
  count: number;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const layer = layerInfo(step.layer);
  const name = step.text || "Untitled step";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-6 shrink-0 font-mono text-xs text-sub" aria-hidden="true">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={onToggle}
        data-step-toggle={step.id}
        aria-pressed={step.done}
        className="flex min-w-0 flex-1 basis-48 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {step.done ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
        )}
        <span className={cn("text-sm", step.done ? "text-sub line-through" : "text-text")}>
          <span className="sr-only">Done:</span> {name}
        </span>
      </button>
      <span
        className={cn("shrink-0 rounded border px-1.5 text-xs font-medium", layer.tag)}
        title={layer.meaning}
      >
        <span className="sr-only">Layer:</span> {layer.label}
      </span>
      {inBacklog(step) && (
        <Link
          href="/sprint-planning"
          className="inline-flex shrink-0 items-center gap-0.5 text-xs text-success underline-offset-2 hover:underline"
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          In backlog
        </Link>
      )}
      <span className="flex shrink-0 items-center">
        <IconButton
          label={`Move ${name} up`}
          icon={<ArrowUp className="h-4 w-4" />}
          className="text-sub hover:text-text"
          disabled={index === 0}
          data-step-move={`${step.id}:up`}
          onClick={() => onMove(-1)}
        />
        <IconButton
          label={`Move ${name} down`}
          icon={<ArrowDown className="h-4 w-4" />}
          className="text-sub hover:text-text"
          disabled={index >= count - 1}
          data-step-move={`${step.id}:down`}
          onClick={() => onMove(1)}
        />
        <IconButton
          label={`Edit ${name}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          data-step-edit={step.id}
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
