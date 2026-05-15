"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Bot, Plus, Trash2 } from "lucide-react";
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
import type { RlhfPair, Workspace } from "@/lib/stores/workspace-types";
import { generateRlhfPrompts } from "@/lib/ai-prompts/rlhf-log";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RLHF_ACTIONS } from "@/lib/history/event-actions";

export function RlhfLogClient() {
  const list = useWorkspaceStore((s) => s.rlhfPairs ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertRlhfPair);
  const removeOne = useWorkspaceStore((s) => s.removeRlhfPair);
  const { log } = useHistoryLogger("rlhf-log");
  const exportRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [winner, setWinner] = useState<RlhfPair["winner"]>("A");
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");

  function add() {
    if (!prompt.trim() || !a.trim() || !b.trim()) return;
    const item: RlhfPair = {
      id: crypto.randomUUID(),
      prompt: prompt.trim(),
      responseA: a.trim(),
      responseB: b.trim(),
      winner,
      reviewer: reviewer.trim() || undefined,
      reason: reason.trim() || undefined,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(RLHF_ACTIONS.PAIR_LOGGED, { winner });
    setPrompt(""); setA(""); setB(""); setReason(""); setReviewer(""); setWinner("A");
  }

  function remove(id: string) {
    removeOne(id);
    log(RLHF_ACTIONS.PAIR_REMOVED, { id });
  }

  const winA = list.filter((x) => x.winner === "A").length;
  const winB = list.filter((x) => x.winner === "B").length;
  const ties = list.filter((x) => x.winner === "tie").length;

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    rlhfPairs: s.rlhfPairs,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "RLHF Feedback Log",
    prompts: generateRlhfPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Date", "Prompt", "A", "B", "Winner", "Reviewer", "Reason"],
    rows: list.map((x) => [x.loggedAt.slice(0, 10), x.prompt.slice(0, 100), x.responseA.slice(0, 100), x.responseB.slice(0, 100), x.winner, x.reviewer ?? "", x.reason ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="rlhf-log"
      title="RLHF Feedback Log"
      description="Pairwise comparisons used as a dataset for RLHF or DPO training: prompt, A, B, winner, reviewer, reason."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <KPI label="A wins" value={String(winA)} />
          <KPI label="B wins" value={String(winB)} />
          <KPI label="Ties" value={String(ties)} />
        </div>

        <SectionCard title="Log pairwise comparison" icon={Plus}>
          <Textarea placeholder="Prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="font-mono text-xs" rows={2} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Textarea placeholder="Response A" value={a} onChange={(e) => setA(e.target.value)} rows={4} />
            <Textarea placeholder="Response B" value={b} onChange={(e) => setB(e.target.value)} rows={4} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            <Select value={winner} onValueChange={(v) => setWinner(v as RlhfPair["winner"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A wins</SelectItem>
                <SelectItem value="B">B wins</SelectItem>
                <SelectItem value="tie">Tie</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Reviewer (optional)" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Log pair</Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Pairs (${list.length})`}
            icon={Bot}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="rlhf-log" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list].sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime()).slice(0, 30).map((x) => (
                <li key={x.id} className="border border-border bg-surface-deep rounded p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-sub font-mono">{x.loggedAt.slice(0, 10)} · {x.reviewer ?? "—"}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: x.winner === "tie" ? "#88888820" : x.winner === "A" ? "#00f0ff20" : "#ff00aa20", color: x.winner === "tie" ? "#888" : x.winner === "A" ? "#00f0ff" : "#ff00aa" }}>{x.winner}</span>
                      <button onClick={() => remove(x.id)} aria-label="Remove pair" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                  <p className="text-xs text-text mb-2 truncate">Prompt: {x.prompt}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="bg-surface rounded p-2 border border-cyan-500/20"><span className="text-cyan-400 text-[10px] uppercase">A</span><div className="text-sub mt-1">{x.responseA.slice(0, 200)}</div></div>
                    <div className="bg-surface rounded p-2 border border-pink-500/20"><span className="text-pink-400 text-[10px] uppercase">B</span><div className="text-sub mt-1">{x.responseB.slice(0, 200)}</div></div>
                  </div>
                  {x.reason && <p className="text-xs text-sub mt-2 italic">Reason: {x.reason}</p>}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold mt-1 font-data">{value}</div>
    </div>
  );
}
