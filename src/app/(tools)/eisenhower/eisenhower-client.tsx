"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Square, Plus, Trash2 } from "lucide-react";
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
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateEisenhowerPrompts } from "@/lib/ai-prompts/eisenhower";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { EISENHOWER_ACTIONS } from "@/lib/history/event-actions";

type Quadrant = "do" | "schedule" | "delegate" | "delete";
const QUADRANTS: { id: Quadrant; label: string; subtitle: string; color: string }[] = [
  { id: "do", label: "Do", subtitle: "Urgent + Important", color: "#ff6b6b" },
  { id: "schedule", label: "Schedule", subtitle: "Important, not urgent", color: "#00f0ff" },
  { id: "delegate", label: "Delegate", subtitle: "Urgent, not important", color: "#ffaa00" },
  { id: "delete", label: "Delete", subtitle: "Neither", color: "#888" },
];

export function EisenhowerClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "eisenhower"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("eisenhower");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [quadrant, setQuadrant] = useState<Quadrant>("do");

  function add() {
    const t = title.trim().slice(0, 240);
    if (!t) return;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(), framework: "eisenhower", title: t,
      fields: { quadrant }, status: "scored", updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(EISENHOWER_ACTIONS.TASK_ADDED, { title: t, quadrant });
    setTitle("");
  }

  function move(id: string, q: Quadrant) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    upsert({ ...it, fields: { ...(it.fields ?? {}), quadrant: q }, updatedAt: new Date().toISOString() });
    log(EISENHOWER_ACTIONS.TASK_MOVED, { id, quadrant: q });
  }

  const grouped = useMemo(() => {
    const m: Record<Quadrant, PrioritizationItem[]> = { do: [], schedule: [], delegate: [], delete: [] };
    for (const it of items) {
      // Validate the quadrant against the known set before indexing — a
      // stale persisted value (or a renamed enum) would otherwise resolve
      // to `m[unknown]` = undefined and crash with
      // "Cannot read property 'push' of undefined" on board load.
      const raw = it.fields?.quadrant;
      const q: Quadrant = raw === "schedule" || raw === "delegate" || raw === "delete" ? raw : "do";
      m[q].push(it);
    }
    return m;
  }, [items]);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    prioritizations: s.prioritizations,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Eisenhower Matrix",
    prompts: generateEisenhowerPrompts({ grouped }, workspace),
  }), [grouped, workspace]);

  const csvData = {
    headers: ["Quadrant", "Title"],
    rows: items.map((it) => [String(it.fields?.quadrant ?? ""), it.title]),
  };

  return (
    <ToolPageWrapper
      toolId="eisenhower"
      title="Eisenhower Matrix"
      description="Plot tasks on Urgent vs Important axes; decide Do / Schedule / Delegate / Delete."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add task" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input className="sm:col-span-2" placeholder="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Select value={quadrant} onValueChange={(v) => setQuadrant(v as Quadrant)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{QUADRANTS.map((q) => <SelectItem key={q.id} value={q.id}>{q.label} — {q.subtitle}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add</Button>
        </SectionCard>

        <SectionCard
          title={`Quadrants (${items.length} tasks)`}
          icon={Square}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton filename="eisenhower" csvData={csvData} jsonData={items} targetRef={exportRef} />
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUADRANTS.map((q) => (
              <div key={q.id} className="border border-border rounded p-3 bg-surface-deep">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold uppercase" style={{ color: q.color }}>{q.label}</span>
                  <span className="text-xs text-sub">{grouped[q.id].length}</span>
                </div>
                <p className="text-xs text-sub italic mb-2">{q.subtitle}</p>
                <ul className="space-y-1 text-sm">
                  {grouped[q.id].map((it) => (
                    <li key={it.id} className="flex items-center gap-2">
                      <Select value={(it.fields?.quadrant as Quadrant) ?? "do"} onValueChange={(v) => move(it.id, v as Quadrant)}>
                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{QUADRANTS.map((opt) => <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="flex-1 truncate text-text">{it.title}</span>
                      <button onClick={() => { removeOne(it.id); log(EISENHOWER_ACTIONS.TASK_REMOVED, { id: it.id }); }} aria-label="Remove task" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
