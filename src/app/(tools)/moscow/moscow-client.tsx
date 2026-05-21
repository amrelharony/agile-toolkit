"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ListChecks, Plus, Trash2 } from "lucide-react";
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
import { generateMoscowPrompts } from "@/lib/ai-prompts/moscow";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MOSCOW_ACTIONS } from "@/lib/history/event-actions";

type Bucket = "must" | "should" | "could" | "wont";
const BUCKETS: { id: Bucket; label: string; color: string }[] = [
  { id: "must", label: "Must have", color: "#ff00aa" },
  { id: "should", label: "Should have", color: "#00f0ff" },
  { id: "could", label: "Could have", color: "#ffaa00" },
  { id: "wont", label: "Won't have (this time)", color: "#888" },
];

export function MoscowClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "moscow"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("moscow");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [bucket, setBucket] = useState<Bucket>("must");

  function add() {
    if (!title.trim()) return;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(), framework: "moscow", title: title.trim().slice(0, 200),
      fields: { bucket }, status: "scored", updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(MOSCOW_ACTIONS.ITEM_ADDED, { title: item.title, bucket });
    setTitle("");
  }

  function move(id: string, b: Bucket) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    upsert({ ...it, fields: { ...(it.fields ?? {}), bucket: b }, updatedAt: new Date().toISOString() });
    log(MOSCOW_ACTIONS.BUCKET_CHANGED, { id, bucket: b });
  }

  function remove(id: string) {
    removeOne(id);
    log(MOSCOW_ACTIONS.ITEM_REMOVED, { id });
  }

  const grouped = useMemo(() => {
    const m: Record<Bucket, PrioritizationItem[]> = { must: [], should: [], could: [], wont: [] };
    for (const it of items) {
      const raw = it.fields?.bucket as Bucket;
      const b: Bucket = raw === "must" || raw === "should" || raw === "could" || raw === "wont" ? raw : "must";
      m[b].push(it);
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
    toolName: "MoSCoW Matrix",
    prompts: generateMoscowPrompts({ grouped }, workspace),
  }), [grouped, workspace]);

  const csvData = {
    headers: ["Bucket", "Title"],
    rows: items.map((it) => [String(it.fields?.bucket ?? "must"), it.title]),
  };

  return (
    <ToolPageWrapper
      toolId="moscow"
      title="MoSCoW Matrix"
      description="Bucket scope into Must / Should / Could / Won't to align cross-functional teams on what's in vs out."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add scope item" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input className="sm:col-span-2" placeholder="Scope item" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Select value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{BUCKETS.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add</Button>
        </SectionCard>

        <SectionCard
          title={`Buckets (${items.length} items)`}
          icon={ListChecks}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton filename="moscow" csvData={csvData} jsonData={items} targetRef={exportRef} />
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUCKETS.map((b) => (
              <div key={b.id} className="border border-border rounded p-3 bg-surface-deep">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold uppercase tracking-wider" style={{ color: b.color }}>{b.label}</span>
                  <span className="text-xs text-sub">{grouped[b.id].length}</span>
                </div>
                <ul className="space-y-1">
                  {grouped[b.id].map((it) => (
                    <li key={it.id} className="flex items-center gap-2 text-sm">
                      <Select value={(it.fields?.bucket as Bucket) ?? "must"} onValueChange={(v) => move(it.id, v as Bucket)}>
                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{BUCKETS.map((opt) => <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="flex-1 truncate text-text">{it.title}</span>
                      <button onClick={() => remove(it.id)} aria-label="Remove scope item" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
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
