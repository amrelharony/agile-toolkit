"use client";

import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { ShieldHalf, CheckCircle2, Circle } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { generateAISafetyPrompts } from "@/lib/ai-prompts/ai-safety-checklist";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { AI_SAFETY_ACTIONS } from "@/lib/history/event-actions";

const CHECKLIST_ID = "aiSafetyChecklist:current"; // MUST match ai-safety-checklist.ts.
const EMPTY_CHECKS: Record<string, boolean> = {};

// Synced workspace singleton (was isolated localStorage), so MCP item toggles
// round-trip into the UI. `set(id, value)` mirrors the old store API.
function useChecklist() {
  const stored = useWorkspaceStore(
    useShallow((s) => (s.aiSafetyChecklists ?? []).find((c) => c.id === CHECKLIST_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertAiSafetyChecklist);
  // Stable empty reference when nothing's saved — avoids a re-render loop in
  // the useMemo deps that read `checks`.
  const checks = stored?.checks ?? EMPTY_CHECKS;
  const set = (id: string, v: boolean) => {
    const cur = (useWorkspaceStore.getState().aiSafetyChecklists ?? []).find(
      (c) => c.id === CHECKLIST_ID
    );
    upsert({ id: CHECKLIST_ID, checks: { ...(cur?.checks ?? {}), [id]: v } });
  };
  return { checks, set };
}

const SECTIONS: { title: string; items: { id: string; text: string }[] }[] = [
  {
    title: "Data Privacy",
    items: [
      { id: "pii-scrub", text: "PII is scrubbed or never sent to the model" },
      { id: "data-retention", text: "Data-retention policy reviewed with the vendor" },
      {
        id: "logging-policy",
        text: "Logging excludes raw user input by default; opt-in for debugging",
      },
      { id: "consent", text: "User consent collected where required (GDPR/CCPA)" },
    ],
  },
  {
    title: "Security",
    items: [
      { id: "prompt-injection", text: "Prompt-injection tests passed (system prompt is robust)" },
      { id: "jailbreak", text: "Jailbreak attempts produce safe refusals" },
      { id: "rate-limit", text: "Rate limiting and abuse protection in place" },
      { id: "secrets", text: "No secrets, API keys, or tokens leak to the model" },
    ],
  },
  {
    title: "Content & Safety",
    items: [
      { id: "content-policy", text: "Content policy mapped to vendor's policy" },
      {
        id: "harmful-content",
        text: "Harmful-content categories filtered (CSAM, self-harm, etc.)",
      },
      { id: "bias-tested", text: "Bias-evaluation set run; results documented" },
      { id: "kid-safety", text: "If under-18 access possible, age-appropriate handling reviewed" },
    ],
  },
  {
    title: "Operational",
    items: [
      { id: "fallback", text: "Fallback path defined for model outage / refusal" },
      { id: "monitor", text: "Quality + cost monitoring dashboards live" },
      { id: "incident-runbook", text: "Incident-response runbook for AI-specific failures" },
      { id: "rollback", text: "Feature-flag rollback tested and documented" },
    ],
  },
  {
    title: "Governance / NIST RMF Alignment",
    items: [
      { id: "nist-govern", text: "GOVERN function mapped (responsible owner, policies)" },
      { id: "nist-map", text: "MAP function mapped (context, risks identified)" },
      { id: "nist-measure", text: "MEASURE function mapped (eval set, monitoring)" },
      { id: "nist-manage", text: "MANAGE function mapped (mitigation plan, comms)" },
    ],
  },
];

export function AISafetyChecklistClient() {
  const { checks, set } = useChecklist();
  const { log } = useHistoryLogger("ai-safety-checklist");
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
        redTeamFindings: s.redTeamFindings,
        hallucinations: s.hallucinations,
      })
    )
  );

  const total = SECTIONS.reduce((s, sec) => s + sec.items.length, 0);
  const done = Object.values(checks).filter(Boolean).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const promptConfig = useMemo(
    () => ({
      toolName: "AI Safety Review Checklist",
      prompts: generateAISafetyPrompts({ checks: checks, sections: SECTIONS }, workspace),
    }),
    [checks, workspace]
  );

  const csvData = {
    headers: ["Section", "Item", "Done"],
    rows: SECTIONS.flatMap((sec) =>
      sec.items.map((it) => [sec.title, it.text, checks[it.id] ? "yes" : "no"])
    ),
  };

  return (
    <ToolPageWrapper
      toolId="ai-safety-checklist"
      title="AI Safety Review Checklist"
      description="Pre-launch checklist across data privacy, security, content, operations, and NIST RMF alignment."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard
          title={`Completion: ${done}/${total} (${pct}%)`}
          icon={ShieldHalf}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="ai-safety-checklist"
                csvData={csvData}
                jsonData={checks}
                targetRef={exportRef}
              />
            </>
          }
        >
          <div
            className="w-full bg-surface-deep h-2 rounded overflow-hidden"
            role="progressbar"
            aria-label={`Checklist completion ${done} of ${total}`}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-2 bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
        </SectionCard>

        {SECTIONS.map((sec) => (
          <SectionCard key={sec.title} title={sec.title}>
            <ul className="space-y-1">
              {sec.items.map((it) => {
                const checked = !!checks[it.id];
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={it.text}
                      onClick={() => {
                        set(it.id, !checked);
                        log(AI_SAFETY_ACTIONS.ITEM_TOGGLED, { id: it.id, on: !checked });
                      }}
                      className="flex items-center gap-2 w-full text-left rounded p-1.5 hover:bg-surface-deep"
                    >
                      {checked ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-sub shrink-0" />
                      )}
                      <span
                        className={`text-sm ${checked ? "text-sub line-through" : "text-text"}`}
                      >
                        {it.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        ))}
      </div>
    </ToolPageWrapper>
  );
}
