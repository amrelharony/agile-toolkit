"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Clock, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateCostOfDelayPrompts } from "@/lib/ai-prompts/cost-of-delay";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { COD_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function CostOfDelayClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  // CoD has its own framework value so WSJF items aren't mixed in.
  const codItems = useMemo(() => all.filter((x) => x.framework === "cost-of-delay"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("cost-of-delay");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [perWeekUsd, setPerWeekUsd] = useState("");
  const [weeksDelayed, setWeeksDelayed] = useState("");

  function add() {
    if (!title.trim()) return;
    const wk = parseFloat(perWeekUsd);
    const dl = parseFloat(weeksDelayed);
    const safeWk = Number.isFinite(wk) ? Math.max(0, wk) : 0;
    const safeDl = Number.isFinite(dl) ? Math.max(0, dl) : 0;
    const total = safeWk * safeDl;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(), framework: "cost-of-delay", title: title.trim(),
      score: total,
      fields: { perWeekUsd: safeWk, weeksDelayed: safeDl, totalCost: total },
      status: "scored", updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(COD_ACTIONS.ITEM_ADDED, { title: item.title, totalCost: item.score });
    emitSignal({ kind: "prioritization.scored", at: item.updatedAt, toolId: "cost-of-delay", payload: { framework: "cost-of-delay", id: item.id, score: total } });
    setTitle(""); setPerWeekUsd(""); setWeeksDelayed("");
  }
  const totalCost = codItems.reduce((s, x) => s + (x.score ?? 0), 0);
  const sorted = [...codItems].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const chartData = sorted.slice(0, 10).map((it) => ({
    title: it.title.length > 18 ? it.title.slice(0, 18) + "…" : it.title,
    cost: Math.round(it.score ?? 0),
  }));

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    prioritizations: s.prioritizations,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Cost-of-Delay Tracker",
    prompts: generateCostOfDelayPrompts({ items: sorted, totalCost }, workspace),
  }), [sorted, totalCost, workspace]);

  const csvData = {
    headers: ["Title", "Per week ($)", "Weeks delayed", "Total cost ($)"],
    rows: codItems.map((it) => [it.title, it.fields?.perWeekUsd ?? 0, it.fields?.weeksDelayed ?? 0, it.score ?? 0]),
  };

  return (
    <ToolPageWrapper
      toolId="cost-of-delay"
      title="Cost-of-Delay Tracker"
      description="Quantify the per-week revenue/value loss of delaying each initiative. Pairs with WSJF for queue management."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add initiative & estimate cost" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Input className="sm:col-span-2" placeholder="Initiative" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="number" step="100" placeholder="Cost per week ($)" value={perWeekUsd} onChange={(e) => setPerWeekUsd(e.target.value)} />
            <Input type="number" placeholder="Weeks delayed" value={weeksDelayed} onChange={(e) => setWeeksDelayed(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add</Button>
        </SectionCard>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KPI label="Total CoD this period" value={`$${totalCost.toLocaleString()}`} />
          <KPI label="Items tracked" value={String(codItems.length)} />
        </div>

        {chartData.length > 0 && (
          <SectionCard
            title="Top 10 by total cost"
            icon={Clock}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="cost-of-delay" csvData={csvData} jsonData={codItems} targetRef={exportRef} />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="#888" fontSize={11} />
                  <YAxis type="category" dataKey="title" stroke="#888" fontSize={11} width={150} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                  <Bar dataKey="cost" fill="#ff6b6b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {sorted.length > 0 && (
          <SectionCard title={`Items (${sorted.length})`}>
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-sub uppercase">
                  <th className="p-2">Title</th>
                  <th className="p-2 text-right">$/week</th>
                  <th className="p-2 text-right">Weeks</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {sorted.map((it) => (
                    <tr key={it.id} className="border-t border-border">
                      <td className="p-2">{it.title}</td>
                      <td className="p-2 text-right font-mono text-xs">${(Number(it.fields?.perWeekUsd) || 0).toLocaleString()}</td>
                      <td className="p-2 text-right font-mono text-xs">{Number(it.fields?.weeksDelayed) || 0}</td>
                      <td className="p-2 text-right font-mono">${Math.round(it.score ?? 0).toLocaleString()}</td>
                      <td className="p-2"><button onClick={() => { removeOne(it.id); log(COD_ACTIONS.ITEM_REMOVED, { id: it.id }); }} aria-label="Remove initiative" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button></td>
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

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold mt-1 font-data">{value}</div>
    </div>
  );
}
