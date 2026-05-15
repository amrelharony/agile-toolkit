"use client";

import { useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { Repeat, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { generateModelMigrationPrompts } from "@/lib/ai-prompts/model-migration";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MODEL_MIGRATION_ACTIONS } from "@/lib/history/event-actions";

interface Step { id: string; text: string; done: boolean; }
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

const useStore = create<State>()(persist((set) => ({
  fromModel: "", toModel: "", evalDeltaPct: "", costDeltaPct: "",
  steps: DEFAULT_STEPS.map((t) => ({ id: crypto.randomUUID(), text: t, done: false })),
  setFromModel: (v) => set({ fromModel: v }),
  setToModel: (v) => set({ toModel: v }),
  setEvalDelta: (v) => set({ evalDeltaPct: v }),
  setCostDelta: (v) => set({ costDeltaPct: v }),
  addStep: (text) => set((s) => ({ steps: [...s.steps, { id: crypto.randomUUID(), text, done: false }] })),
  toggleStep: (id) => set((s) => ({ steps: s.steps.map((st) => st.id === id ? { ...st, done: !st.done } : st) })),
  removeStep: (id) => set((s) => ({ steps: s.steps.filter((st) => st.id !== id) })),
}), { name: "agile-toolkit:model-migration" }));

export function ModelMigrationClient() {
  const store = useStore();
  const { log } = useHistoryLogger("model-migration");
  const exportRef = useRef<HTMLDivElement>(null);
  const [newStep, setNewStep] = useState("");

  const done = store.steps.filter((s) => s.done).length;
  const pct = store.steps.length === 0 ? 0 : Math.round((done / store.steps.length) * 100);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    models: s.models, llmEvals: s.llmEvals,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Model Upgrade Migration Tracker",
    prompts: generateModelMigrationPrompts({
      fromModel: store.fromModel, toModel: store.toModel,
      evalDeltaPct: store.evalDeltaPct, costDeltaPct: store.costDeltaPct,
      steps: store.steps,
    }, workspace),
  }), [store.fromModel, store.toModel, store.evalDeltaPct, store.costDeltaPct, store.steps, workspace]);

  const csvData = {
    headers: ["Step", "Done"],
    rows: store.steps.map((s) => [s.text, s.done ? "yes" : "no"]),
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
            <Input placeholder="From model" value={store.fromModel} onChange={(e) => store.setFromModel(e.target.value)} />
            <Input placeholder="To model" value={store.toModel} onChange={(e) => store.setToModel(e.target.value)} />
            <Input placeholder="Eval delta % (e.g. +2.1)" value={store.evalDeltaPct} onChange={(e) => store.setEvalDelta(e.target.value)} />
            <Input placeholder="Cost delta % (e.g. -18)" value={store.costDeltaPct} onChange={(e) => store.setCostDelta(e.target.value)} />
          </div>
          <div className="mt-3 w-full bg-surface-deep h-2 rounded overflow-hidden">
            <div className="h-2 bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 text-xs text-sub">{done}/{store.steps.length} steps complete ({pct}%)</div>
        </SectionCard>

        <SectionCard
          title="Migration steps"
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton filename="model-migration" csvData={csvData} jsonData={store.steps} targetRef={exportRef} />
            </>
          }
        >
          <ul className="space-y-1">
            {store.steps.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-surface-deep">
                <button
                  onClick={() => { store.toggleStep(s.id); log(MODEL_MIGRATION_ACTIONS.STEP_TOGGLED, { id: s.id }); }}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {s.done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Circle className="w-4 h-4 text-sub" />}
                  <span className={`text-sm ${s.done ? "text-sub line-through" : "text-text"}`}>{s.text}</span>
                </button>
                <button onClick={() => store.removeStep(s.id)} aria-label="Remove step" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-3">
            <Input placeholder="Add step…" value={newStep} onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newStep.trim()) { store.addStep(newStep.trim()); log(MODEL_MIGRATION_ACTIONS.STEP_ADDED, { text: newStep.trim() }); setNewStep(""); } }}
            />
            <Button onClick={() => { if (newStep.trim()) { store.addStep(newStep.trim()); log(MODEL_MIGRATION_ACTIONS.STEP_ADDED, { text: newStep.trim() }); setNewStep(""); } }} className="gap-1"><Plus className="w-4 h-4" />Add</Button>
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
