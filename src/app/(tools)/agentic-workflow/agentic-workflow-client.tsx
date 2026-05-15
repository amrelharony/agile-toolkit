"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Workflow, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AgentNode, AgentWorkflow, Workspace } from "@/lib/stores/workspace-types";
import { generateAgenticWorkflowPrompts } from "@/lib/ai-prompts/agentic-workflow";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { AGENTIC_WORKFLOW_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const KIND_COLORS: Record<AgentNode["kind"], string> = {
  agent: "#00f0ff", tool: "#9d4edd", human: "#00ff88", fallback: "#ff6b6b", branch: "#ffaa00",
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

  function addWorkflow() {
    if (!wfName.trim()) return;
    const wf: AgentWorkflow = { id: crypto.randomUUID(), name: wfName.trim(), description: wfDesc.trim() || undefined };
    upsertWf(wf);
    log(AGENTIC_WORKFLOW_ACTIONS.WORKFLOW_ADDED, { name: wf.name });
    emitSignal({ kind: "agentWorkflow.created", at: new Date().toISOString(), toolId: "agentic-workflow", payload: wf });
    setActiveWfId(wf.id);
    setWfName(""); setWfDesc("");
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
    setNodeLabel(""); setNodeDesc("");
  }

  const activeWf = workflows.find((w) => w.id === activeWfId);
  const wfNodes = useMemo(() => nodes.filter((n) => n.workflowId === activeWfId), [nodes, activeWfId]);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    agentWorkflows: s.agentWorkflows, agentNodes: s.agentNodes,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Agentic Workflow Designer",
    prompts: generateAgenticWorkflowPrompts({ workflow: activeWf, nodes: wfNodes }, workspace),
  }), [activeWf, wfNodes, workspace]);

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
            <Input placeholder="Workflow name" value={wfName} onChange={(e) => setWfName(e.target.value)} />
            <Input placeholder="Description (optional)" value={wfDesc} onChange={(e) => setWfDesc(e.target.value)} />
            <Button onClick={addWorkflow} className="gap-1"><Plus className="w-4 h-4" />Create</Button>
          </div>
          {workflows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {workflows.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => setActiveWfId(wf.id)}
                  className={`text-xs px-2 py-1 rounded border ${wf.id === activeWfId ? "bg-accent/20 border-accent text-accent" : "bg-surface-deep border-border text-sub hover:text-text"}`}
                >
                  {wf.name}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeWf(wf.id); log(AGENTIC_WORKFLOW_ACTIONS.WORKFLOW_REMOVED, { id: wf.id }); }}
                    className="ml-2 text-sub hover:text-red-400"
                    aria-label="Remove workflow"
                  ><Trash2 className="w-3 h-3 inline" /></button>
                </button>
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
                <ExportButton filename={`workflow-${activeWf.name}`} csvData={csvData} jsonData={{ workflow: activeWf, nodes: wfNodes }} targetRef={exportRef} />
              </>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="Step label" value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} />
              <Select value={nodeKind} onValueChange={(v) => setNodeKind(v as AgentNode["kind"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={addNode} className="gap-1"><Plus className="w-4 h-4" />Add step</Button>
            </div>
            <Textarea placeholder="Description (optional)" value={nodeDesc} onChange={(e) => setNodeDesc(e.target.value)} className="mt-2" rows={2} />
            <ol className="mt-3 space-y-1.5">
              {wfNodes.map((n, i) => (
                <li key={n.id} className="flex items-center gap-2 border border-border bg-surface-deep rounded p-2">
                  <span className="text-xs text-sub font-mono w-6">#{i + 1}</span>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: KIND_COLORS[n.kind] + "20", color: KIND_COLORS[n.kind] }}>{n.kind}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text truncate">{n.label}</div>
                    {n.description && <div className="text-xs text-sub truncate">{n.description}</div>}
                  </div>
                  <button onClick={() => { removeNode(n.id); log(AGENTIC_WORKFLOW_ACTIONS.NODE_REMOVED, { id: n.id }); }} aria-label="Remove step" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ol>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
