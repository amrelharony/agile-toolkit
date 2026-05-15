"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Activity, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OODACycle, Workspace } from "@/lib/stores/workspace-types";
import { generateOodaPrompts } from "@/lib/ai-prompts/ooda-loop";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { OODA_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function OodaLoopClient() {
  const list = useWorkspaceStore((s) => s.oodaCycles ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertOODACycle);
  const removeOne = useWorkspaceStore((s) => s.removeOODACycle);
  const { log } = useHistoryLogger("ooda-loop");
  const exportRef = useRef<HTMLDivElement>(null);

  const [topic, setTopic] = useState("");

  function start() {
    if (!topic.trim()) return;
    const item: OODACycle = {
      id: crypto.randomUUID(), topic: topic.trim(),
      startedAt: new Date().toISOString(),
    };
    upsert(item);
    log(OODA_ACTIONS.CYCLE_STARTED, { topic: item.topic });
    setTopic("");
  }

  function update(c: OODACycle, field: keyof OODACycle, value: string) {
    upsert({ ...c, [field]: value });
    log(OODA_ACTIONS.STAGE_UPDATED, { id: c.id, field });
  }

  function complete(c: OODACycle) {
    const next: OODACycle = { ...c, completedAt: new Date().toISOString() };
    upsert(next);
    log(OODA_ACTIONS.CYCLE_COMPLETED, { topic: c.topic });
    emitSignal({ kind: "ooda.cycleCompleted", at: next.completedAt!, toolId: "ooda-loop", payload: next });
  }

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    oodaCycles: s.oodaCycles,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "OODA Loop",
    prompts: generateOodaPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Topic", "Started", "Observe", "Orient", "Decide", "Act", "Completed"],
    rows: list.map((c) => [c.topic, c.startedAt, c.observe ?? "", c.orient ?? "", c.decide ?? "", c.act ?? "", c.completedAt ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="ooda-loop"
      title="OODA Loop Tracker"
      description="Boyd's Observe-Orient-Decide-Act cycle for rapid adaptation in chaotic or adversarial conditions. Run one per fast-moving situation."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Start new cycle" icon={Plus}>
          <div className="flex gap-2">
            <Input placeholder="Topic / situation" value={topic} onChange={(e) => setTopic(e.target.value)} />
            <Button onClick={start} className="gap-1"><Plus className="w-4 h-4" />Start</Button>
          </div>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Cycles (${list.length})`}
            icon={Activity}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="ooda-cycles" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-3">
              {[...list].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).map((c) => (
                <li key={c.id} className={`border rounded p-3 ${c.completedAt ? "bg-emerald-500/5 border-emerald-500/30" : "bg-surface-deep border-border"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-text">{c.topic}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-sub font-mono">{c.startedAt.slice(0, 16).replace("T", " ")}</span>
                      {!c.completedAt && <button onClick={() => complete(c)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle2 className="w-4 h-4" /></button>}
                      <button onClick={() => { removeOne(c.id); log(OODA_ACTIONS.CYCLE_REMOVED, { id: c.id }); }} aria-label="Remove cycle" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-cyan-400 font-bold mb-1">Observe</label>
                      <Textarea rows={2} value={c.observe ?? ""} onChange={(e) => update(c, "observe", e.target.value)} placeholder="What's happening?" />
                    </div>
                    <div>
                      <label className="block text-emerald-400 font-bold mb-1">Orient</label>
                      <Textarea rows={2} value={c.orient ?? ""} onChange={(e) => update(c, "orient", e.target.value)} placeholder="What does it mean? Context, biases, mental models." />
                    </div>
                    <div>
                      <label className="block text-amber-400 font-bold mb-1">Decide</label>
                      <Textarea rows={2} value={c.decide ?? ""} onChange={(e) => update(c, "decide", e.target.value)} placeholder="What's the call?" />
                    </div>
                    <div>
                      <label className="block text-pink-400 font-bold mb-1">Act</label>
                      <Textarea rows={2} value={c.act ?? ""} onChange={(e) => update(c, "act", e.target.value)} placeholder="What did we do? Outcome." />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
