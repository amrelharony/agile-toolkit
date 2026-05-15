"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { Grid3X3, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateValueEffortPrompts } from "@/lib/ai-prompts/value-effort-matrix";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VALUE_EFFORT_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

function quadrantOf(value: number, effort: number): "Quick Wins" | "Big Bets" | "Fill-Ins" | "Time Wasters" {
  const hiV = value >= 5, hiE = effort >= 5;
  if (hiV && !hiE) return "Quick Wins";
  if (hiV && hiE) return "Big Bets";
  if (!hiV && !hiE) return "Fill-Ins";
  return "Time Wasters";
}
const QUAD_COLORS: Record<string, string> = {
  "Quick Wins": "#00ff88", "Big Bets": "#00f0ff", "Fill-Ins": "#ffaa00", "Time Wasters": "#ff6b6b",
};

export function ValueEffortMatrixClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "value-effort"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("value-effort-matrix");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [effort, setEffort] = useState("");

  function add() {
    if (!title.trim()) return;
    const v = parseFloat(value) || 5, e = parseFloat(effort) || 5;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(), framework: "value-effort", title: title.trim(),
      score: v - e,
      fields: { value: v, effort: e, quadrant: quadrantOf(v, e) },
      status: "scored", updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(VALUE_EFFORT_ACTIONS.ITEM_ADDED, { title, quadrant: item.fields?.quadrant });
    emitSignal({ kind: "prioritization.scored", at: item.updatedAt, toolId: "value-effort-matrix", payload: { framework: "value-effort", id: item.id, score: v - e } });
    setTitle(""); setValue(""); setEffort("");
  }

  const scatterData = items.map((it) => ({
    title: it.title, x: Number(it.fields?.effort) || 0, y: Number(it.fields?.value) || 0, quadrant: String(it.fields?.quadrant ?? ""),
  }));

  const grouped: Record<string, PrioritizationItem[]> = { "Quick Wins": [], "Big Bets": [], "Fill-Ins": [], "Time Wasters": [] };
  for (const it of items) grouped[String(it.fields?.quadrant ?? "Fill-Ins")]?.push(it);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    prioritizations: s.prioritizations,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Value vs Effort Matrix",
    prompts: generateValueEffortPrompts({ grouped }, workspace),
  }), [grouped, workspace]);

  const csvData = {
    headers: ["Title", "Value", "Effort", "Quadrant"],
    rows: items.map((it) => [it.title, it.fields?.value ?? "", it.fields?.effort ?? "", String(it.fields?.quadrant ?? "")]),
  };

  return (
    <ToolPageWrapper
      toolId="value-effort-matrix"
      title="Value vs Effort Matrix"
      description="Plot items into Quick Wins / Big Bets / Fill-Ins / Time Wasters quadrants based on value (1–10) and effort (1–10)."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add item" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Input className="sm:col-span-2" placeholder="Item title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="number" min="1" max="10" placeholder="Value 1-10" value={value} onChange={(e) => setValue(e.target.value)} />
            <Input type="number" min="1" max="10" placeholder="Effort 1-10" value={effort} onChange={(e) => setEffort(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Plot</Button>
        </SectionCard>

        {scatterData.length > 0 && (
          <SectionCard
            title="Matrix"
            icon={Grid3X3}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="value-effort" csvData={csvData} jsonData={items} targetRef={exportRef} />
              </>
            }
          >
            <div className="-mx-2 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" dataKey="x" name="Effort" domain={[0, 10]} stroke="#888" fontSize={11} label={{ value: "Effort", position: "insideBottom", offset: -5, fill: "#888", fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name="Value" domain={[0, 10]} stroke="#888" fontSize={11} label={{ value: "Value", angle: -90, position: "insideLeft", fill: "#888", fontSize: 11 }} />
                  <ReferenceLine x={5} stroke="rgba(255,255,255,0.15)" />
                  <ReferenceLine y={5} stroke="rgba(255,255,255,0.15)" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                  <Scatter data={scatterData} fill="#00f0ff" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(grouped).map(([q, list]) => (
              <div key={q} className="border border-border rounded p-3 bg-surface-deep">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold uppercase" style={{ color: QUAD_COLORS[q] }}>{q}</span>
                  <span className="text-xs text-sub">{list.length}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {list.map((it) => (
                    <li key={it.id} className="flex justify-between items-center">
                      <span className="text-text truncate flex-1">{it.title}</span>
                      <span className="text-xs text-sub mx-2">v{it.fields?.value} e{it.fields?.effort}</span>
                      <button onClick={() => { removeOne(it.id); log(VALUE_EFFORT_ACTIONS.ITEM_REMOVED, { id: it.id }); }} aria-label="Remove item" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
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
