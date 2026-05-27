"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { IdCard, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelCard, Workspace } from "@/lib/stores/workspace-types";
import { generateModelCardPrompts } from "@/lib/ai-prompts/model-card";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MODEL_CARD_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function ModelCardClient() {
  const list = useWorkspaceStore((s) => s.modelCards ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertModelCard);
  const removeOne = useWorkspaceStore((s) => s.removeModelCard);
  const { log } = useHistoryLogger("model-card");
  const exportRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Omit<ModelCard, "id" | "updatedAt">>({
    modelName: "",
    intendedUse: "",
    trainingData: "",
    evaluation: "",
    limitations: "",
    license: "",
  });

  function save() {
    if (!draft.modelName.trim()) return;
    const item: ModelCard = {
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      ...draft,
    };
    upsert(item);
    log(MODEL_CARD_ACTIONS.CARD_SAVED, { modelName: item.modelName });
    emitSignal({
      kind: "modelCard.published",
      at: item.updatedAt,
      toolId: "model-card",
      payload: item,
    });
    setDraft({
      modelName: "",
      intendedUse: "",
      trainingData: "",
      evaluation: "",
      limitations: "",
      license: "",
    });
  }

  function remove(id: string) {
    removeOne(id);
    log(MODEL_CARD_ACTIONS.CARD_REMOVED, { id });
  }

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
        modelCards: s.modelCards,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Model Card Builder",
      prompts: generateModelCardPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  const csvData = {
    headers: [
      "Model",
      "Intended use",
      "Training data",
      "Evaluation",
      "Limitations",
      "License",
      "Updated",
    ],
    rows: list.map((c) => [
      c.modelName,
      c.intendedUse ?? "",
      c.trainingData ?? "",
      c.evaluation ?? "",
      c.limitations ?? "",
      c.license ?? "",
      c.updatedAt,
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="model-card"
      title="Model Card Builder"
      description="Templated documentation for each model: intended use, training data, evaluation, biases & limitations, license."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="New model card" icon={Plus}>
          <Input
            placeholder="Model name"
            value={draft.modelName}
            onChange={(e) => setDraft({ ...draft, modelName: e.target.value })}
          />
          <Textarea
            placeholder="Intended use"
            value={draft.intendedUse}
            onChange={(e) => setDraft({ ...draft, intendedUse: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <Textarea
            placeholder="Training data"
            value={draft.trainingData}
            onChange={(e) => setDraft({ ...draft, trainingData: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <Textarea
            placeholder="Evaluation results"
            value={draft.evaluation}
            onChange={(e) => setDraft({ ...draft, evaluation: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <Textarea
            placeholder="Limitations & biases"
            value={draft.limitations}
            onChange={(e) => setDraft({ ...draft, limitations: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <Input
            placeholder="License"
            value={draft.license}
            onChange={(e) => setDraft({ ...draft, license: e.target.value })}
            className="mt-2"
          />
          <Button onClick={save} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Save card
          </Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Cards (${list.length})`}
            icon={IdCard}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="model-cards"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-3">
              {list.map((c) => (
                <li key={c.id} className="border border-border bg-surface-deep rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-text">{c.modelName}</span>
                    <button
                      onClick={() => remove(c.id)}
                      aria-label="Remove model card"
                      className="text-sub hover:text-red-400 min-touch-coarse inline-flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {c.intendedUse && (
                    <p className="text-xs text-sub mb-1">
                      <span className="text-text">Use:</span> {c.intendedUse}
                    </p>
                  )}
                  {c.evaluation && (
                    <p className="text-xs text-sub mb-1">
                      <span className="text-text">Eval:</span> {c.evaluation}
                    </p>
                  )}
                  {c.limitations && (
                    <p className="text-xs text-sub mb-1">
                      <span className="text-text">Limits:</span> {c.limitations}
                    </p>
                  )}
                  {c.license && (
                    <p className="text-xs text-sub">
                      <span className="text-text">License:</span> {c.license}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
