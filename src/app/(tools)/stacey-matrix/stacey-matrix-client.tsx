"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { Atom, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StaceyItem, Workspace } from "@/lib/stores/workspace-types";
import { generateStaceyPrompts } from "@/lib/ai-prompts/stacey-matrix";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { STACEY_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

function regionOf(agreement: number, certainty: number): StaceyItem["region"] {
  // 0..1 scales — 0.33 / 0.66 split bands.
  if (agreement >= 0.66 && certainty >= 0.66) return "simple";
  if (agreement <= 0.33 && certainty <= 0.33) return "chaotic";
  if ((agreement >= 0.66 && certainty <= 0.66) || (certainty >= 0.66 && agreement <= 0.66)) return "complicated";
  return "complex";
}
const COLORS: Record<NonNullable<StaceyItem["region"]>, string> = {
  simple: "#00ff88", complicated: "#00f0ff", complex: "#9d4edd", chaotic: "#ff6b6b",
};

export function StaceyMatrixClient() {
  const list = useWorkspaceStore((s) => s.staceyItems ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertStaceyItem);
  const removeOne = useWorkspaceStore((s) => s.removeStaceyItem);
  const { log } = useHistoryLogger("stacey-matrix");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [agreement, setAgreement] = useState("0.5");
  const [certainty, setCertainty] = useState("0.5");

  function add() {
    if (!title.trim()) return;
    const a = Math.max(0, Math.min(1, parseFloat(agreement) || 0.5));
    const c = Math.max(0, Math.min(1, parseFloat(certainty) || 0.5));
    const item: StaceyItem = {
      id: crypto.randomUUID(),
      title: title.trim(),
      agreement: a,
      certainty: c,
      region: regionOf(a, c),
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(STACEY_ACTIONS.ITEM_ADDED, { title: item.title, region: item.region });
    emitSignal({ kind: "decision.staceyClassified", at: item.loggedAt, toolId: "stacey-matrix", payload: item });
    setTitle(""); setAgreement("0.5"); setCertainty("0.5");
  }

  const scatter = list.map((it) => ({ title: it.title, x: it.certainty, y: it.agreement, region: it.region }));
  const grouped = useMemo(() => {
    const m: Record<string, StaceyItem[]> = { simple: [], complicated: [], complex: [], chaotic: [] };
    for (const it of list) m[it.region ?? "complex"].push(it);
    return m;
  }, [list]);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    staceyItems: s.staceyItems,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Stacey Matrix",
    prompts: generateStaceyPrompts({ items: list, grouped }, workspace),
  }), [list, grouped, workspace]);

  const csvData = {
    headers: ["Title", "Agreement", "Certainty", "Region"],
    rows: list.map((it) => [it.title, it.agreement, it.certainty, it.region ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="stacey-matrix"
      title="Stacey Matrix"
      description="Plot work on Certainty (how) vs Agreement (what), 0–1. The plot region recommends a leadership approach."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Plot item" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Item / problem" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="number" step="0.05" min="0" max="1" placeholder="Agreement 0-1" value={agreement} onChange={(e) => setAgreement(e.target.value)} />
            <Input type="number" step="0.05" min="0" max="1" placeholder="Certainty 0-1" value={certainty} onChange={(e) => setCertainty(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Plot</Button>
        </SectionCard>

        {scatter.length > 0 && (
          <SectionCard
            title="Matrix"
            icon={Atom}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="stacey-matrix" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <div className="-mx-2 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" dataKey="x" name="Certainty" domain={[0, 1]} stroke="#888" fontSize={11} label={{ value: "Certainty (how)", position: "insideBottom", offset: -5, fill: "#888", fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name="Agreement" domain={[0, 1]} stroke="#888" fontSize={11} label={{ value: "Agreement (what)", angle: -90, position: "insideLeft", fill: "#888", fontSize: 11 }} />
                  <ReferenceLine x={0.33} stroke="rgba(255,255,255,0.1)" />
                  <ReferenceLine x={0.66} stroke="rgba(255,255,255,0.1)" />
                  <ReferenceLine y={0.33} stroke="rgba(255,255,255,0.1)" />
                  <ReferenceLine y={0.66} stroke="rgba(255,255,255,0.1)" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                  <Scatter data={scatter} fill="#00f0ff" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {list.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["simple", "complicated", "complex", "chaotic"] as const).map((r) => (
              <div key={r} className="border border-border rounded p-3 bg-surface-deep">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold uppercase" style={{ color: COLORS[r] }}>{r}</span>
                  <span className="text-xs text-sub">{grouped[r].length}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {grouped[r].map((it) => (
                    <li key={it.id} className="flex items-center justify-between">
                      <span className="text-text truncate flex-1">{it.title}</span>
                      <span className="text-xs text-sub mx-2 font-mono">a{it.agreement.toFixed(2)} c{it.certainty.toFixed(2)}</span>
                      <button onClick={() => { removeOne(it.id); log(STACEY_ACTIONS.ITEM_REMOVED, { id: it.id }); }} aria-label="Remove item" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolPageWrapper>
  );
}
