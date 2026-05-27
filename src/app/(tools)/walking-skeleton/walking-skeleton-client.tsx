"use client";

import { useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { useShallow } from "zustand/react/shallow";
import { Boxes, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { generateWalkingSkeletonPrompts } from "@/lib/ai-prompts/walking-skeleton";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WALKING_SKELETON_ACTIONS } from "@/lib/history/event-actions";

interface Step {
  id: string;
  layer: "ui" | "api" | "data" | "infra";
  text: string;
  done: boolean;
}
interface State {
  goal: string;
  steps: Step[];
  setGoal: (v: string) => void;
  add: (text: string, layer: Step["layer"]) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
}
const useStore = create<State>()(
  persist(
    (set) => ({
      goal: "",
      steps: [],
      setGoal: (v) => set({ goal: v }),
      add: (text, layer) =>
        set((s) => ({
          steps: [...s.steps, { id: crypto.randomUUID(), text, layer, done: false }],
        })),
      toggle: (id) =>
        set((s) => ({
          steps: s.steps.map((st) => (st.id === id ? { ...st, done: !st.done } : st)),
        })),
      remove: (id) => set((s) => ({ steps: s.steps.filter((st) => st.id !== id) })),
    }),
    { name: "agile-toolkit:walking-skeleton", storage: safeJSONStorage("walking-skeleton") }
  )
);

const LAYERS: Step["layer"][] = ["ui", "api", "data", "infra"];
const LAYER_COLORS: Record<Step["layer"], string> = {
  ui: "#00f0ff",
  api: "#00ff88",
  data: "#9d4edd",
  infra: "#ffaa00",
};

export function WalkingSkeletonClient() {
  const store = useStore();
  const { log } = useHistoryLogger("walking-skeleton");
  const exportRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState("");
  const [layer, setLayer] = useState<Step["layer"]>("ui");

  const done = store.steps.filter((s) => s.done).length;
  const pct = store.steps.length === 0 ? 0 : Math.round((done / store.steps.length) * 100);

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
      prompts: generateWalkingSkeletonPrompts({ goal: store.goal, steps: store.steps }, workspace),
    }),
    [store.goal, store.steps, workspace]
  );

  const csvData = {
    headers: ["Layer", "Step", "Done"],
    rows: store.steps.map((s) => [s.layer, s.text, s.done ? "yes" : "no"]),
  };

  return (
    <ToolPageWrapper
      toolId="walking-skeleton"
      title="Walking Skeleton Builder"
      description="Define the smallest end-to-end implementation that proves the architecture works (Cockburn). Walk one happy path through every layer."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Goal">
          <BlurTextarea
            placeholder="What's the smallest end-to-end happy path you can ship?"
            value={store.goal}
            onCommit={store.setGoal}
            rows={2}
          />
          <div className="mt-3 w-full bg-surface-deep h-2 rounded overflow-hidden">
            <div className="h-2 bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 text-xs text-sub">
            {done}/{store.steps.length} steps complete ({pct}%)
          </div>
        </SectionCard>

        <SectionCard title="Add step" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              className="sm:col-span-2"
              placeholder="Step description"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <select
              aria-label="Architectural layer for this step"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={layer}
              onChange={(e) => setLayer(e.target.value as Step["layer"])}
            >
              {LAYERS.map((l) => (
                <option key={l} value={l}>
                  Layer: {l}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={() => {
              if (text.trim()) {
                store.add(text.trim(), layer);
                log(WALKING_SKELETON_ACTIONS.STEP_ADDED, { layer });
                setText("");
              }
            }}
            className="mt-3 gap-1"
          >
            <Plus className="w-4 h-4" />
            Add step
          </Button>
        </SectionCard>

        {store.steps.length > 0 && (
          <SectionCard
            title="Skeleton steps"
            icon={Boxes}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="walking-skeleton"
                  csvData={csvData}
                  jsonData={store.steps}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {LAYERS.map((l) => {
                const layerSteps = store.steps.filter((s) => s.layer === l);
                if (layerSteps.length === 0) return null;
                return (
                  <div key={l} className="border border-border rounded p-3 bg-surface-deep">
                    <div
                      className="text-xs font-bold uppercase mb-2"
                      style={{ color: LAYER_COLORS[l] }}
                    >
                      {l}
                    </div>
                    <ul className="space-y-1">
                      {layerSteps.map((s) => (
                        <li key={s.id} className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              store.toggle(s.id);
                              log(WALKING_SKELETON_ACTIONS.STEP_TOGGLED, { id: s.id });
                            }}
                            className="flex items-center gap-2 flex-1 text-left"
                          >
                            {s.done ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Circle className="w-4 h-4 text-sub" />
                            )}
                            <span
                              className={`text-sm ${s.done ? "text-sub line-through" : "text-text"}`}
                            >
                              {s.text}
                            </span>
                          </button>
                          <button
                            onClick={() => store.remove(s.id)}
                            aria-label="Remove step"
                            className="text-sub hover:text-red-400 min-touch-coarse inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
