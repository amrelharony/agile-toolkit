"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { Workflow, Plus, Trash2, Beaker, ChevronDown, ChevronRight } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AgentNode, AgentWorkflow, Workspace } from "@/lib/stores/workspace-types";
import { generateAgenticWorkflowPrompts } from "@/lib/ai-prompts/agentic-workflow";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { AGENTIC_WORKFLOW_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { themed, tint } from "@/lib/utils/theme-color";

// Lazy-load — adapter chunks stay async for users who only sketch
// workflows without running them.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2 border border-border rounded">Loading panel…</div>
  ),
});

const KIND_COLORS: Record<AgentNode["kind"], string> = {
  agent: "#00f0ff",
  tool: "#9d4edd",
  human: "#00ff88",
  fallback: "#ff6b6b",
  branch: "#ffaa00",
};
const KINDS: AgentNode["kind"][] = ["agent", "tool", "human", "fallback", "branch"];

export function AgenticWorkflowClient() {
  const workflows = useWorkspaceStore((s) => s.agentWorkflows ?? []);
  const nodes = useWorkspaceStore((s) => s.agentNodes ?? []);
  const upsertWf = useWorkspaceStore((s) => s.upsertAgentWorkflow);
  const removeWf = useWorkspaceStore((s) => s.removeAgentWorkflow);
  const upsertNode = useWorkspaceStore((s) => s.upsertAgentNode);
  const removeNode = useWorkspaceStore((s) => s.removeAgentNode);
  const { log } = useHistoryLogger("agentic-workflow");
  const exportRef = useRef<HTMLDivElement>(null);

  const [wfName, setWfName] = useState("");
  const [wfDesc, setWfDesc] = useState("");
  const [activeWfId, setActiveWfId] = useState<string>(workflows[0]?.id ?? "");
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeKind, setNodeKind] = useState<AgentNode["kind"]>("agent");
  const [nodeDesc, setNodeDesc] = useState("");
  // Which node's inline test panel is currently expanded. Only one open at
  // a time — running 5 concurrent streams from a single workflow page is
  // both an actual cost surprise and a UX confusion.
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const llm = useActiveLlm();

  function addWorkflow() {
    if (!wfName.trim()) return;
    const wf: AgentWorkflow = {
      id: crypto.randomUUID(),
      name: wfName.trim(),
      description: wfDesc.trim() || undefined,
    };
    upsertWf(wf);
    log(AGENTIC_WORKFLOW_ACTIONS.WORKFLOW_ADDED, { name: wf.name });
    emitSignal({
      kind: "agentWorkflow.created",
      at: new Date().toISOString(),
      toolId: "agentic-workflow",
      payload: wf,
    });
    setActiveWfId(wf.id);
    setWfName("");
    setWfDesc("");
  }

  function addNode() {
    if (!activeWfId || !nodeLabel.trim()) return;
    const n: AgentNode = {
      id: crypto.randomUUID(),
      workflowId: activeWfId,
      label: nodeLabel.trim(),
      kind: nodeKind,
      description: nodeDesc.trim() || undefined,
    };
    upsertNode(n);
    log(AGENTIC_WORKFLOW_ACTIONS.NODE_ADDED, { label: n.label, kind: n.kind });
    // BUG-RD3-agentic-workflow-1: also reset nodeKind to "agent" so a
    // one-off "tool" selection doesn't silently sticky-apply to every
    // subsequent node the user types — they had to notice the wrong
    // chip later and edit.
    setNodeLabel("");
    setNodeDesc("");
    setNodeKind("agent");
  }

  const activeWf = workflows.find((w) => w.id === activeWfId);
  const wfNodes = useMemo(
    () => nodes.filter((n) => n.workflowId === activeWfId),
    [nodes, activeWfId]
  );

  // Auto-select first workflow after hydration if none selected (race: initial
  // useState ran before persist rehydrated, so workflows[0] was undefined).
  useEffect(() => {
    if (!activeWfId && workflows.length > 0) setActiveWfId(workflows[0]!.id);
  }, [workflows, activeWfId]);

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
        agentWorkflows: s.agentWorkflows,
        agentNodes: s.agentNodes,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Agentic Workflow Designer",
      prompts: generateAgenticWorkflowPrompts({ workflow: activeWf, nodes: wfNodes }, workspace),
    }),
    [activeWf, wfNodes, workspace]
  );

  const csvData = {
    headers: ["Workflow", "Step", "Kind", "Description"],
    rows: wfNodes.map((n) => [activeWf?.name ?? "", n.label, n.kind, n.description ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="agentic-workflow"
      title="Agentic Workflow Designer"
      description="Sketch agent flows: agent steps, tools, fallbacks, and human-in-the-loop checkpoints, all in a flat node list."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Workflows" icon={Workflow}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Workflow name"
              aria-label="Workflow name"
              value={wfName}
              onChange={(e) => setWfName(e.target.value)}
            />
            <Input
              placeholder="Description (optional)"
              aria-label="Workflow description (optional)"
              value={wfDesc}
              onChange={(e) => setWfDesc(e.target.value)}
            />
            <Button onClick={addWorkflow} className="gap-1">
              <Plus className="w-4 h-4" />
              Create
            </Button>
          </div>
          {workflows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className={`inline-flex items-center text-xs rounded border ${wf.id === activeWfId ? "bg-accent/20 border-accent text-accent" : "bg-surface-deep border-border text-sub"}`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveWfId(wf.id)}
                    aria-pressed={wf.id === activeWfId}
                    className="px-2 py-1 hover:text-text"
                  >
                    {wf.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeWf(wf.id);
                      log(AGENTIC_WORKFLOW_ACTIONS.WORKFLOW_REMOVED, { id: wf.id });
                      if (wf.id === activeWfId) setActiveWfId("");
                    }}
                    className="pr-2 py-1 text-sub hover:text-danger min-touch-coarse inline-flex items-center justify-center"
                    aria-label={`Remove workflow ${wf.name}`}
                  >
                    <Trash2 className="w-3 h-3 inline" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {activeWf && (
          <SectionCard
            title={`Steps in "${activeWf.name}" (${wfNodes.length})`}
            icon={Workflow}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename={`workflow-${activeWf.name}`}
                  csvData={csvData}
                  jsonData={{ workflow: activeWf, nodes: wfNodes }}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder="Step label"
                aria-label="Step label"
                value={nodeLabel}
                onChange={(e) => setNodeLabel(e.target.value)}
              />
              <Select value={nodeKind} onValueChange={(v) => setNodeKind(v as AgentNode["kind"])}>
                <SelectTrigger aria-label="Step kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={addNode} className="gap-1">
                <Plus className="w-4 h-4" />
                Add step
              </Button>
            </div>
            <Textarea
              placeholder="Description (optional)"
              aria-label="Step description (optional)"
              value={nodeDesc}
              onChange={(e) => setNodeDesc(e.target.value)}
              className="mt-2"
              rows={2}
            />
            <ol className="mt-3 space-y-1.5">
              {wfNodes.map((n, i) => {
                const isTesting = testingNodeId === n.id;
                const isAgent = n.kind === "agent";
                // Compose the per-step prompt by joining label + description.
                // Description is optional; without it the model only sees the
                // label, which is often enough for quick iteration.
                const stepPrompt = [n.label, n.description?.trim()].filter(Boolean).join("\n\n");
                return (
                  <li key={n.id} className="border border-border bg-surface-deep rounded">
                    <div className="flex items-center gap-2 p-2">
                      <span className="text-xs text-sub font-mono w-6">#{i + 1}</span>
                      <span
                        className="text-xs uppercase font-bold px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: tint(KIND_COLORS[n.kind], 13),
                          color: themed(KIND_COLORS[n.kind]),
                        }}
                      >
                        {n.kind}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text truncate">{n.label}</div>
                        {n.description && (
                          <div className="text-xs text-sub truncate">{n.description}</div>
                        )}
                      </div>
                      {/* Test step button — agent-kind only. Other node kinds
                          aren't executable as LLM prompts (tool steps call
                          external code; human steps need a person; fallbacks
                          are reactive; branches are routers). */}
                      {isAgent && (
                        <button
                          type="button"
                          onClick={() => setTestingNodeId(isTesting ? null : n.id)}
                          disabled={!llm.isReady}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-sub hover:text-accent hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-sub disabled:hover:border-border"
                          title={
                            !llm.isReady
                              ? "Configure an AI provider in settings to test this step"
                              : isTesting
                                ? "Hide test panel"
                                : "Run this step's prompt against your BYOK provider"
                          }
                          aria-label={isTesting ? "Hide test panel" : "Test step"}
                          aria-expanded={isTesting}
                        >
                          {isTesting ? (
                            <ChevronDown className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-3 h-3" aria-hidden="true" />
                          )}
                          <Beaker className="w-3 h-3" aria-hidden="true" />
                          Test
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          removeNode(n.id);
                          log(AGENTIC_WORKFLOW_ACTIONS.NODE_REMOVED, { id: n.id });
                          if (testingNodeId === n.id) setTestingNodeId(null);
                        }}
                        aria-label={`Remove step: ${n.label}`}
                        className="text-sub hover:text-danger min-touch-coarse inline-flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                    {isAgent && isTesting && llm.isReady && (
                      <div className="px-2 pb-2">
                        <AiRunPanel prompt={stepPrompt} toolName={`Agentic step: ${n.label}`} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
