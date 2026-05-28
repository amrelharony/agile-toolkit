"use client";

import { useMemo, useRef, useId } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileText } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace, AiFeatureSpec } from "@/lib/stores/workspace-types";
import { generateAIFeatureSpecPrompts } from "@/lib/ai-prompts/ai-feature-spec";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { AI_FEATURE_SPEC_ACTIONS } from "@/lib/history/event-actions";

const SPEC_ID = "aiFeatureSpec:current"; // MUST match SPEC_ID in ai-feature-spec.ts.
const empty = {
  featureName: "",
  problem: "",
  modelChoice: "",
  evalCriteria: "",
  fallback: "",
  latencyBudgetMs: "",
  hallucinationTolerance: "",
  costBudget: "",
  humanLoop: "",
  rolloutPlan: "",
  successMetric: "",
};
const emptySpec: AiFeatureSpec = { id: SPEC_ID, ...empty };

// Synced workspace singleton (was isolated localStorage), so MCP spec writes
// round-trip into the UI. `set(field, value)` mirrors the old store API.
function useSpec() {
  const stored = useWorkspaceStore(
    useShallow((s) => (s.aiFeatureSpecs ?? []).find((x) => x.id === SPEC_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertAiFeatureSpec);
  const spec = stored ?? emptySpec;
  const set = (k: keyof typeof empty, v: string) => {
    const cur =
      (useWorkspaceStore.getState().aiFeatureSpecs ?? []).find((x) => x.id === SPEC_ID) ??
      emptySpec;
    upsert({ ...cur, [k]: v, id: SPEC_ID });
  };
  return { spec, set };
}

const FIELDS: Array<{
  key: keyof typeof empty;
  label: string;
  placeholder: string;
  rows?: number;
}> = [
  { key: "featureName", label: "Feature name", placeholder: "Smart inbox triage", rows: 1 },
  {
    key: "problem",
    label: "Problem & user goal",
    placeholder: "What user job does this solve?",
    rows: 3,
  },
  {
    key: "modelChoice",
    label: "Model choice & justification",
    placeholder: "GPT-5 — best on classification benchmarks",
    rows: 2,
  },
  {
    key: "evalCriteria",
    label: "Eval criteria (what 'good' means)",
    placeholder: "Pass when accuracy ≥ 0.85 on golden-set v3",
    rows: 3,
  },
  {
    key: "fallback",
    label: "Fallback if model fails",
    placeholder: "Show suggested actions only; never auto-act",
    rows: 2,
  },
  { key: "latencyBudgetMs", label: "Latency budget (ms p95)", placeholder: "1500", rows: 1 },
  {
    key: "hallucinationTolerance",
    label: "Hallucination tolerance",
    placeholder: "Zero for facts; soft cap 5% for tone suggestions",
    rows: 2,
  },
  {
    key: "costBudget",
    label: "Cost budget",
    placeholder: "≤ $0.02 per request; ≤ $400/mo total",
    rows: 2,
  },
  {
    key: "humanLoop",
    label: "Human-in-the-loop checkpoints",
    placeholder: "Reviewer must approve actions on confidence < 0.6",
    rows: 2,
  },
  {
    key: "rolloutPlan",
    label: "Rollout plan",
    placeholder: "1% canary 7 days → 10% 7 days → 100%",
    rows: 2,
  },
  {
    key: "successMetric",
    label: "Success metric",
    placeholder: "30-day retention +5% on cohorts using the feature",
    rows: 2,
  },
];

/**
 * Per-field row with proper label-input association via htmlFor + id, and
 * onBlur-based history logging to avoid emitting an event on every keystroke
 * (spec fields can hold paragraphs — keystroke logging used to flood the log).
 */
function SpecField({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: (typeof FIELDS)[number];
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const id = useId();
  const rows = field.rows ?? 1;
  return (
    <div>
      <label htmlFor={id} className="block text-xs uppercase tracking-wider text-sub mb-1">
        {field.label}
      </label>
      {rows > 1 ? (
        <Textarea
          id={id}
          rows={rows}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      ) : (
        <Input
          id={id}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      )}
    </div>
  );
}

export function AIFeatureSpecClient() {
  const { spec, set } = useSpec();
  const { log } = useHistoryLogger("ai-feature-spec");
  const exportRef = useRef<HTMLDivElement>(null);

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
        llmEvals: s.llmEvals,
        models: s.models,
        hallucinations: s.hallucinations,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "AI Feature Spec",
      prompts: generateAIFeatureSpecPrompts(spec as unknown as Record<string, string>, workspace),
    }),
    [spec, workspace]
  );

  const markdown = useMemo(() => {
    return (
      `# AI Feature Spec — ${spec.featureName || "(unnamed)"}\n\n` +
      FIELDS.map(
        (f) => `## ${f.label}\n\n${(spec as unknown as Record<string, string>)[f.key] || "_TBD_"}`
      ).join("\n\n")
    );
  }, [spec]);

  const csvData = {
    headers: ["Section", "Value"],
    rows: FIELDS.map((f) => [f.label, (spec as unknown as Record<string, string>)[f.key] || ""]),
  };

  return (
    <ToolPageWrapper
      toolId="ai-feature-spec"
      title="AI Feature Spec"
      description="A PRD variant tailored for AI features — model choice, evals, fallbacks, latency, cost, human-in-the-loop, and rollout."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard
          title="Spec sections"
          icon={FileText}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="ai-feature-spec"
                csvData={csvData}
                jsonData={spec}
                clipboardText={markdown}
                targetRef={exportRef}
              />
            </>
          }
        >
          <div className="space-y-3">
            {FIELDS.map((f) => (
              <SpecField
                key={f.key}
                field={f}
                value={(spec as unknown as Record<string, string>)[f.key]}
                onChange={(v) => set(f.key, v)}
                onCommit={() => log(AI_FEATURE_SPEC_ACTIONS.SECTION_UPDATED, { section: f.key })}
              />
            ))}
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
