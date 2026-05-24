"use client";

import { useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { useShallow } from "zustand/react/shallow";
import { Repeat, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { generateModelMigrationPrompts } from "@/lib/ai-prompts/model-migration";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MODEL_MIGRATION_ACTIONS } from "@/lib/history/event-actions";

interface Step {
  id: string;
  text: string;
  done: boolean;
}
interface State {
  fromModel: string;
  toModel: string;
  evalDeltaPct: string;
  costDeltaPct: string;
  steps: Step[];
  setFromModel: (v: string) => void;
  setToModel: (v: string) => void;
  setEvalDelta: (v: string) => void;
  setCostDelta: (v: string) => void;
  addStep: (text: string) => void;
  toggleStep: (id: string) => void;
  removeStep: (id: string) => void;
}

const DEFAULT_STEPS = [
  "Run baseline eval suite on current model",
  "Run eval suite on candidate model",
  "Compare cost-per-request",
  "Compare latency p50/p95",
  "Behaviour-diff golden inputs (sample 50)",
  "Update prompt for new model conventions",
  "Canary roll to 1% traffic",
  "Monitor 7 days for regressions",
  "Roll to 100% with feature flag fallback",
  "Deprecate old model in registry",
];

// Use deterministic IDs for the default step list so SSR and the first client
// render don't produce different UUIDs (which causes a hydration mismatch).
// New steps the user adds still get a fresh `crypto.randomUUID()`.
function defaultSteps(): Step[] {
  return DEFAULT_STEPS.map((t, i) => ({ id: `default-step-${i}`, text: t, done: false }));
}

const useStore = create<State>()(
  persist(
    (set) => ({
      fromModel: "",
      toModel: "",
      evalDeltaPct: "",
      costDeltaPct: "",
      steps: defaultSteps(),
      setFromModel: (v) => set({ fromModel: v }),
      setToModel: (v) => set({ toModel: v }),
      setEvalDelta: (v) => set({ evalDeltaPct: v }),
      setCostDelta: (v) => set({ costDeltaPct: v }),
      addStep: (text) =>
        set((s) => ({ steps: [...s.steps, { id: crypto.randomUUID(), text, done: false }] })),
      toggleStep: (id) =>
        set((s) => ({
          steps: s.steps.map((st) => (st.id === id ? { ...st, done: !st.done } : st)),
        })),
      removeStep: (id) => set((s) => ({ steps: s.steps.filter((st) => st.id !== id) })),
    }),
    { name: "agile-toolkit:model-migration", storage: safeJSONStorage("model-migration") }
  )
);

export function ModelMigrationClient() {
  // Use granular selectors so every keystroke in another input doesn't tear
  // down and re-render every Textarea. `useStore()` with no selector would
  // re-render the whole component on every state slice change.
  const fromModel = useStore((s) => s.fromModel);
  const toModel = useStore((s) => s.toModel);
  const evalDeltaPct = useStore((s) => s.evalDeltaPct);
  const costDeltaPct = useStore((s) => s.costDeltaPct);
  const steps = useStore((s) => s.steps);
  const setFromModel = useStore((s) => s.setFromModel);
  const setToModel = useStore((s) => s.setToModel);
  const setEvalDelta = useStore((s) => s.setEvalDelta);
  const setCostDelta = useStore((s) => s.setCostDelta);
  const addStepFn = useStore((s) => s.addStep);
  const toggleStep = useStore((s) => s.toggleStep);
  const removeStep = useStore((s) => s.removeStep);
  const { log } = useHistoryLogger("model-migration");
  const exportRef = useRef<HTMLDivElement>(null);
  const [newStep, setNewStep] = useState("");

  const done = steps.filter((s) => s.done).length;
  const pct = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);

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
        models: s.models,
        llmEvals: s.llmEvals,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Model Upgrade Migration Tracker",
      prompts: generateModelMigrationPrompts(
        {
          fromModel,
          toModel,
          evalDeltaPct,
          costDeltaPct,
          steps,
        },
        workspace
      ),
    }),
    [fromModel, toModel, evalDeltaPct, costDeltaPct, steps, workspace]
  );

  const csvData = {
    headers: ["Step", "Done"],
    rows: steps.map((s) => [s.text, s.done ? "yes" : "no"]),
  };

  return (
    <ToolPageWrapper
      toolId="model-migration"
      title="Model Upgrade Migration Tracker"
      description="A checklist + parity-test log for moving between LLM versions: eval delta, cost delta, behavior diff, rollout plan."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Migration overview" icon={Repeat}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* BUG-RD3-model-migration-1: blur-commit so typing in any of
                these four fields doesn't write the entire migration
                state to localStorage per keystroke. */}
            <BlurInput placeholder="From model" value={fromModel} onCommit={setFromModel} />
            <BlurInput placeholder="To model" value={toModel} onCommit={setToModel} />
            <BlurInput
              placeholder="Eval delta % (e.g. +2.1)"
              value={evalDeltaPct}
              onCommit={setEvalDelta}
            />
            <BlurInput
              placeholder="Cost delta % (e.g. -18)"
              value={costDeltaPct}
              onCommit={setCostDelta}
            />
          </div>
          <div className="mt-3 w-full bg-surface-deep h-2 rounded overflow-hidden">
            <div className="h-2 bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 text-xs text-sub">
            {done}/{steps.length} steps complete ({pct}%)
          </div>
        </SectionCard>

        <SectionCard
          title="Migration steps"
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="model-migration"
                csvData={csvData}
                jsonData={steps}
                targetRef={exportRef}
              />
            </>
          }
        >
          <ul className="space-y-1">
            {steps.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-surface-deep"
              >
                <button
                  onClick={() => {
                    toggleStep(s.id);
                    log(MODEL_MIGRATION_ACTIONS.STEP_TOGGLED, { id: s.id });
                  }}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {s.done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Circle className="w-4 h-4 text-sub" />
                  )}
                  <span className={`text-sm ${s.done ? "text-sub line-through" : "text-text"}`}>
                    {s.text}
                  </span>
                </button>
                <button
                  onClick={() => removeStep(s.id)}
                  aria-label="Remove step"
                  className="text-sub hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-3">
            <Input
              placeholder="Add step…"
              value={newStep}
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newStep.trim()) {
                  addStepFn(newStep.trim());
                  log(MODEL_MIGRATION_ACTIONS.STEP_ADDED, { text: newStep.trim() });
                  setNewStep("");
                }
              }}
            />
            <Button
              onClick={() => {
                if (newStep.trim()) {
                  addStepFn(newStep.trim());
                  log(MODEL_MIGRATION_ACTIONS.STEP_ADDED, { text: newStep.trim() });
                  setNewStep("");
                }
              }}
              className="gap-1"
            >
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
