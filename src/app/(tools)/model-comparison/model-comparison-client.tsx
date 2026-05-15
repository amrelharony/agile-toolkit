"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Cpu, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelEntry, Workspace } from "@/lib/stores/workspace-types";
import { generateModelComparisonPrompts } from "@/lib/ai-prompts/model-comparison";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MODEL_COMPARISON_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const STATUSES: ModelEntry["status"][] = ["production", "evaluation", "experimental", "deprecated"];

export function ModelComparisonClient() {
  const list = useWorkspaceStore((s) => s.models ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertModel);
  const removeOne = useWorkspaceStore((s) => s.removeModel);
  const { log } = useHistoryLogger("model-comparison");
  const exportRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [inputCost, setInputCost] = useState("");
  const [outputCost, setOutputCost] = useState("");
  const [contextWin, setContextWin] = useState("");
  const [latencyP50, setLatencyP50] = useState("");
  const [latencyP95, setLatencyP95] = useState("");
  const [evalScore, setEvalScore] = useState("");
  const [status, setStatus] = useState<ModelEntry["status"]>("evaluation");

  function add() {
    if (!name.trim() || !vendor.trim()) return;
    const item: ModelEntry = {
      id: crypto.randomUUID(),
      name: name.trim(),
      vendor: vendor.trim(),
      inputCostPer1k: parseFloat(inputCost) || undefined,
      outputCostPer1k: parseFloat(outputCost) || undefined,
      contextWindow: parseInt(contextWin, 10) || undefined,
      latencyP50Ms: parseInt(latencyP50, 10) || undefined,
      latencyP95Ms: parseInt(latencyP95, 10) || undefined,
      evalScore: parseFloat(evalScore) || undefined,
      status,
    };
    const prior = list.find((m) => m.name === item.name);
    upsert(item);
    log(MODEL_COMPARISON_ACTIONS.MODEL_ADDED, { name: item.name });
    if (prior && prior.id !== item.id) {
      emitSignal({ kind: "model.upgraded", at: new Date().toISOString(), toolId: "model-comparison", payload: { name: item.name } });
    }
    setName(""); setVendor(""); setInputCost(""); setOutputCost(""); setContextWin("");
    setLatencyP50(""); setLatencyP95(""); setEvalScore("");
  }

  function remove(id: string) {
    removeOne(id);
    log(MODEL_COMPARISON_ACTIONS.MODEL_REMOVED, { id });
  }

  const sorted = useMemo(() =>
    [...list].sort((a, b) => (b.evalScore ?? 0) - (a.evalScore ?? 0)),
  [list]);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    models: s.models, llmEvals: s.llmEvals,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Model Comparison",
    prompts: generateModelComparisonPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Name", "Vendor", "Input/1k", "Output/1k", "Context", "p50ms", "p95ms", "Eval", "Status"],
    rows: list.map((m) => [m.name, m.vendor, m.inputCostPer1k ?? "", m.outputCostPer1k ?? "", m.contextWindow ?? "", m.latencyP50Ms ?? "", m.latencyP95Ms ?? "", m.evalScore ?? "", m.status]),
  };

  return (
    <ToolPageWrapper
      toolId="model-comparison"
      title="Model Comparison Matrix"
      description="Compare LLMs side-by-side: cost per 1k tokens, latency, context window, eval score, and lifecycle status."
    >
      <div className="space-y-6" ref={exportRef}>
        <SectionCard title="Add model" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Input placeholder="Model name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            <Input type="number" step="0.001" placeholder="Input $/1k tok" value={inputCost} onChange={(e) => setInputCost(e.target.value)} />
            <Input type="number" step="0.001" placeholder="Output $/1k tok" value={outputCost} onChange={(e) => setOutputCost(e.target.value)} />
            <Input type="number" placeholder="Context window" value={contextWin} onChange={(e) => setContextWin(e.target.value)} />
            <Input type="number" placeholder="Latency p50 ms" value={latencyP50} onChange={(e) => setLatencyP50(e.target.value)} />
            <Input type="number" placeholder="Latency p95 ms" value={latencyP95} onChange={(e) => setLatencyP95(e.target.value)} />
            <Input type="number" step="0.001" placeholder="Eval score 0-1" value={evalScore} onChange={(e) => setEvalScore(e.target.value)} />
            <Select value={status} onValueChange={(v) => setStatus(v as ModelEntry["status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add model</Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Models (${list.length}) — sorted by eval score`}
            icon={Cpu}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="model-comparison" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-sub uppercase">
                  <th className="p-2">Model</th><th className="p-2">Vendor</th>
                  <th className="p-2 text-right">In $/1k</th><th className="p-2 text-right">Out $/1k</th>
                  <th className="p-2 text-right">Ctx</th><th className="p-2 text-right">p50</th><th className="p-2 text-right">p95</th>
                  <th className="p-2 text-right">Eval</th><th className="p-2">Status</th><th className="p-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {sorted.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{m.name}</td>
                      <td className="p-2">{m.vendor}</td>
                      <td className="p-2 text-right font-mono text-xs">{m.inputCostPer1k != null ? `$${m.inputCostPer1k}` : "—"}</td>
                      <td className="p-2 text-right font-mono text-xs">{m.outputCostPer1k != null ? `$${m.outputCostPer1k}` : "—"}</td>
                      <td className="p-2 text-right font-mono text-xs">{m.contextWindow?.toLocaleString() ?? "—"}</td>
                      <td className="p-2 text-right font-mono text-xs">{m.latencyP50Ms ?? "—"}ms</td>
                      <td className="p-2 text-right font-mono text-xs">{m.latencyP95Ms ?? "—"}ms</td>
                      <td className="p-2 text-right font-mono">{m.evalScore != null ? `${(m.evalScore * 100).toFixed(0)}%` : "—"}</td>
                      <td className="p-2 text-xs text-sub">{m.status}</td>
                      <td className="p-2"><button onClick={() => remove(m.id)} aria-label="Remove model" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
