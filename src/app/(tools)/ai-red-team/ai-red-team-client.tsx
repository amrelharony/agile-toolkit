"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ScanSearch, Plus, Trash2, CheckCircle2 } from "lucide-react";
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
import type { RedTeamFinding, Workspace } from "@/lib/stores/workspace-types";
import { generateAIRedTeamPrompts } from "@/lib/ai-prompts/ai-red-team";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { AI_RED_TEAM_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const SEVERITIES: RedTeamFinding["severity"][] = ["low", "medium", "high", "critical"];
const COLORS: Record<RedTeamFinding["severity"], string> = {
  low: "#00ff88", medium: "#ffaa00", high: "#ff6b6b", critical: "#ff00aa",
};

export function AIRedTeamClient() {
  const list = useWorkspaceStore((s) => s.redTeamFindings ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertRedTeamFinding);
  const removeOne = useWorkspaceStore((s) => s.removeRedTeamFinding);
  const { log } = useHistoryLogger("ai-red-team");
  const exportRef = useRef<HTMLDivElement>(null);

  const [vector, setVector] = useState("");
  const [prompt, setPrompt] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [severity, setSeverity] = useState<RedTeamFinding["severity"]>("medium");

  function add() {
    if (!vector.trim()) return;
    const item: RedTeamFinding = {
      id: crypto.randomUUID(),
      attackVector: vector.trim(),
      promptUsed: prompt.trim() || undefined,
      successful,
      severity,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(AI_RED_TEAM_ACTIONS.FINDING_LOGGED, { vector: item.attackVector, successful: item.successful });
    emitSignal({ kind: "redTeam.findingOpened", at: item.loggedAt, toolId: "ai-red-team", payload: item });
    setVector(""); setPrompt(""); setSuccessful(false); setSeverity("medium");
  }

  function resolve(id: string) {
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const next: RedTeamFinding = { ...item, resolvedAt: new Date().toISOString() };
    upsert(next);
    log(AI_RED_TEAM_ACTIONS.FINDING_RESOLVED, { id });
    emitSignal({ kind: "redTeam.findingClosed", at: next.resolvedAt!, toolId: "ai-red-team", payload: next });
  }

  function remove(id: string) {
    removeOne(id);
    log(AI_RED_TEAM_ACTIONS.FINDING_REMOVED, { id });
  }

  const open = list.filter((x) => !x.resolvedAt);
  // Guard divide-by-zero — empty list would otherwise render "NaN%"
  const succRate = list.length === 0
    ? 0
    : Math.round((list.filter((x) => x.successful).length / list.length) * 100);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    redTeamFindings: s.redTeamFindings,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "AI Red-Team Session Log",
    prompts: generateAIRedTeamPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Date", "Vector", "Severity", "Successful", "Prompt", "Mitigation", "Resolved"],
    rows: list.map((x) => [x.loggedAt.slice(0, 10), x.attackVector, x.severity, x.successful ? "yes" : "no", x.promptUsed ?? "", x.mitigation ?? "", x.resolvedAt ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="ai-red-team"
      title="AI Red-Team Session Log"
      description="Document adversarial testing: attack vectors, success rate, severity, and mitigation status."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total findings" value={String(list.length)} />
          <KPI label="Open" value={String(open.length)} tone={open.length > 0 ? "danger" : "ok"} />
          <KPI label="Success rate" value={`${succRate}%`} tone={succRate > 30 ? "danger" : "default"} />
          <KPI label="Critical open" value={String(open.filter((x) => x.severity === "critical").length)} tone="danger" />
        </div>

        <SectionCard title="Log finding" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Attack vector (e.g. prompt injection)" value={vector} onChange={(e) => setVector(e.target.value)} />
            <Select value={severity} onValueChange={(v) => setSeverity(v as RedTeamFinding["severity"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={successful} onChange={(e) => setSuccessful(e.target.checked)} />
              <span>Attack succeeded</span>
            </label>
          </div>
          <Textarea placeholder="Prompt used (optional)" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-2 font-mono text-xs" rows={3} />
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Log finding</Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Findings (${list.length})`}
            icon={ScanSearch}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="ai-red-team" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list].sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime()).map((x) => (
                <li key={x.id} className={`border rounded p-3 text-sm ${x.resolvedAt ? "bg-emerald-500/5 border-emerald-500/30" : "bg-surface-deep border-border"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: COLORS[x.severity] + "20", color: COLORS[x.severity] }}>{x.severity}</span>
                      {x.successful && <span className="text-xs text-red-400 font-bold">SUCCEEDED</span>}
                      <span className="text-text truncate">{x.attackVector}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {!x.resolvedAt && <button onClick={() => resolve(x.id)} aria-label="Mark resolved" title="Mark resolved" className="text-emerald-400 hover:text-emerald-300"><CheckCircle2 className="w-4 h-4" /></button>}
                      <button onClick={() => remove(x.id)} aria-label="Remove finding" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                  {x.promptUsed && <pre className="text-xs text-sub bg-surface rounded p-2 overflow-x-auto whitespace-pre-wrap mt-1">{x.promptUsed.slice(0, 300)}</pre>}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "danger" }) {
  const colorClass = tone === "danger" ? "text-red-400" : tone === "ok" ? "text-emerald-400" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
