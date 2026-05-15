"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Crown, Plus, Trash2, CheckCircle2 } from "lucide-react";
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
import type { DACIDecision, Workspace } from "@/lib/stores/workspace-types";
import { generateDaciPrompts } from "@/lib/ai-prompts/daci";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DACI_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const STATUSES: DACIDecision["status"][] = ["open", "decided", "implemented", "revisit"];

export function DaciClient() {
  const list = useWorkspaceStore((s) => s.daciDecisions ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertDACIDecision);
  const removeOne = useWorkspaceStore((s) => s.removeDACIDecision);
  const { log } = useHistoryLogger("daci");
  const exportRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Omit<DACIDecision, "id" | "date">>({
    title: "", context: "", driver: "", approver: "", contributors: [], informed: [], options: [], recommendation: "", status: "open",
  });

  function add() {
    if (!draft.title.trim()) return;
    const item: DACIDecision = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      ...draft,
    };
    upsert(item);
    log(DACI_ACTIONS.DECISION_ADDED, { title: item.title });
    emitSignal({ kind: "decision.daciCreated", at: item.date, toolId: "daci", payload: item });
    setDraft({ title: "", context: "", driver: "", approver: "", contributors: [], informed: [], options: [], recommendation: "", status: "open" });
  }

  function decide(d: DACIDecision) {
    const next: DACIDecision = { ...d, status: "decided" };
    upsert(next);
    log(DACI_ACTIONS.DECISION_DECIDED, { title: d.title });
  }

  function setStatus(d: DACIDecision, s: DACIDecision["status"]) {
    upsert({ ...d, status: s });
    log(DACI_ACTIONS.DECISION_UPDATED, { id: d.id, status: s });
  }

  function remove(id: string) {
    removeOne(id);
    log(DACI_ACTIONS.DECISION_REMOVED, { id });
  }

  const open = list.filter((x) => x.status === "open").length;

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    daciDecisions: s.daciDecisions,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "DACI Decisions",
    prompts: generateDaciPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Title", "Driver", "Approver", "Status", "Recommendation"],
    rows: list.map((d) => [d.title, d.driver ?? "", d.approver ?? "", d.status, d.recommendation ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="daci"
      title="DACI Decision Doc"
      description="Assign Driver / Approver / Contributors / Informed roles to each decision (Atlassian/Intuit framework)."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <KPI label="Total" value={String(list.length)} />
          <KPI label="Open" value={String(open)} tone={open > 0 ? "danger" : "ok"} />
          <KPI label="Decided" value={String(list.filter((x) => x.status === "decided" || x.status === "implemented").length)} tone="ok" />
        </div>

        <SectionCard title="Draft new decision" icon={Plus}>
          <Input placeholder="Decision title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Textarea placeholder="Context — why are we deciding this?" value={draft.context ?? ""} onChange={(e) => setDraft({ ...draft, context: e.target.value })} className="mt-2" rows={2} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Input placeholder="Driver (the one making it happen)" value={draft.driver ?? ""} onChange={(e) => setDraft({ ...draft, driver: e.target.value })} />
            <Input placeholder="Approver (final say)" value={draft.approver ?? ""} onChange={(e) => setDraft({ ...draft, approver: e.target.value })} />
            <Input placeholder="Contributors (comma-separated)" value={(draft.contributors ?? []).join(", ")} onChange={(e) => setDraft({ ...draft, contributors: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
            <Input placeholder="Informed (comma-separated)" value={(draft.informed ?? []).join(", ")} onChange={(e) => setDraft({ ...draft, informed: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </div>
          <Textarea placeholder="Options considered (one per line)" value={(draft.options ?? []).join("\n")} onChange={(e) => setDraft({ ...draft, options: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} className="mt-2" rows={3} />
          <Textarea placeholder="Recommendation" value={draft.recommendation ?? ""} onChange={(e) => setDraft({ ...draft, recommendation: e.target.value })} className="mt-2" rows={2} />
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add decision</Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Decisions (${list.length})`}
            icon={Crown}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="daci-decisions" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((d) => (
                <li key={d.id} className="border border-border bg-surface-deep rounded p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-text">{d.title}</span>
                    <span className="flex items-center gap-2">
                      <Select value={d.status} onValueChange={(v) => setStatus(d, v as DACIDecision["status"])}>
                        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                      {d.status === "open" && <button onClick={() => decide(d)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle2 className="w-4 h-4" /></button>}
                      <button onClick={() => remove(d.id)} aria-label="Remove decision" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                  {d.context && <p className="text-xs text-sub italic mb-1">{d.context}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                    {d.driver && <div><span className="text-cyan-400 font-bold">D:</span> {d.driver}</div>}
                    {d.approver && <div><span className="text-pink-400 font-bold">A:</span> {d.approver}</div>}
                    {d.contributors && d.contributors.length > 0 && <div><span className="text-emerald-400 font-bold">C:</span> {d.contributors.join(", ")}</div>}
                    {d.informed && d.informed.length > 0 && <div><span className="text-amber-400 font-bold">I:</span> {d.informed.join(", ")}</div>}
                  </div>
                  {d.recommendation && <p className="text-xs text-text mt-2"><span className="text-sub">Rec:</span> {d.recommendation}</p>}
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
