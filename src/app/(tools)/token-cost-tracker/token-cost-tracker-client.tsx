"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { CircleDollarSign, Plus, Trash2, AlertTriangle } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TokenSpend, Workspace } from "@/lib/stores/workspace-types";
import { generateTokenCostPrompts } from "@/lib/ai-prompts/token-cost-tracker";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { TOKEN_COST_ACTIONS } from "@/lib/history/event-actions";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";

interface Cfg { monthlyBudgetUsd: number; }
const useCfg = create<Cfg & { setBudget: (v: number) => void }>()(
  persist((set) => ({ monthlyBudgetUsd: 1000, setBudget: (v) => set({ monthlyBudgetUsd: v }) }), { name: "agile-toolkit:token-cost-cfg", storage: safeJSONStorage("token-cost-cfg") }),
);

export function TokenCostTrackerClient() {
  const list = useWorkspaceStore((s) => s.tokenSpend ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertTokenSpend);
  const removeOne = useWorkspaceStore((s) => s.removeTokenSpend);
  const cfg = useCfg();
  const { log } = useHistoryLogger("token-cost-tracker");
  const exportRef = useRef<HTMLDivElement>(null);

  const [feature, setFeature] = useState("");
  const [model, setModel] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [inputTokens, setInputTokens] = useState("");
  const [outputTokens, setOutputTokens] = useState("");
  const [costUsd, setCostUsd] = useState("");

  function add() {
    const it = parseFloat(inputTokens), ot = parseFloat(outputTokens), c = parseFloat(costUsd);
    // Reject obviously-bad inputs at the entry point: negative tokens / cost
    // would otherwise sneak into totals and the projection (which is the
    // budget signal), where a single typo turns the alert green forever.
    if (!feature.trim() || !model.trim() || !Number.isFinite(c) || c < 0) return;
    const item: TokenSpend = {
      id: crypto.randomUUID(),
      feature: feature.trim(),
      model: model.trim(),
      date,
      inputTokens: Number.isFinite(it) && it >= 0 ? it : 0,
      outputTokens: Number.isFinite(ot) && ot >= 0 ? ot : 0,
      costUsd: c,
    };
    upsert(item);
    log(TOKEN_COST_ACTIONS.SPEND_LOGGED, { feature: item.feature, costUsd: item.costUsd });
    setInputTokens(""); setOutputTokens(""); setCostUsd("");
  }

  function remove(id: string) {
    removeOne(id);
    log(TOKEN_COST_ACTIONS.SPEND_REMOVED, { id });
  }

  // Roll up to daily totals for chart
  const dailyData = useMemo(() => {
    const byDay: Record<string, { date: string; cost: number; tokens: number }> = {};
    for (const x of list) {
      if (!byDay[x.date]) byDay[x.date] = { date: x.date, cost: 0, tokens: 0 };
      byDay[x.date].cost += x.costUsd;
      byDay[x.date].tokens += x.inputTokens + x.outputTokens;
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }, [list]);

  const featureBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of list) m[x.feature] = (m[x.feature] ?? 0) + x.costUsd;
    return Object.entries(m).map(([feature, cost]) => ({ feature, cost })).sort((a, b) => b.cost - a.cost);
  }, [list]);

  // Guard against NaN in totals: a corrupted persisted entry with non-finite
  // costUsd would otherwise poison every downstream KPI and the budget badge.
  const totalSpend = list.reduce(
    (s, x) => s + (Number.isFinite(x.costUsd) ? x.costUsd : 0),
    0,
  );
  const last30Spend = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    // Bound the window on BOTH sides — without an upper bound, future-dated
    // entries (typos like 2099-01-01, or imports from a wrong-locale ISO
    // export) would inflate the "last 30 days" projection used by the budget
    // alert. The CSV import path doesn't validate dates, so this is reachable.
    return list
      .filter((x) => x.date >= cutoff && x.date <= today)
      .reduce((s, x) => s + (Number.isFinite(x.costUsd) ? x.costUsd : 0), 0);
  }, [list]);
  const projected = last30Spend; // simple linear projection — last 30 days = next 30 days
  const overBudget = projected > cfg.monthlyBudgetUsd;

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    tokenSpend: s.tokenSpend, models: s.models,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Token-Cost Tracker",
    prompts: generateTokenCostPrompts({ items: list, monthlyBudgetUsd: cfg.monthlyBudgetUsd }, workspace),
  }), [list, cfg.monthlyBudgetUsd, workspace]);

  const csvData = {
    headers: ["Date", "Feature", "Model", "Input tokens", "Output tokens", "Cost USD"],
    rows: list.map((x) => [x.date, x.feature, x.model, x.inputTokens, x.outputTokens, x.costUsd]),
  };

  return (
    <ToolPageWrapper
      toolId="token-cost-tracker"
      title="Token-Cost Tracker"
      description="Per-feature token spend with daily rollup, projection, and budget alerts."
    >
      <div ref={exportRef} className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
          <KPI label="Last 30d" value={`$${last30Spend.toFixed(2)}`} />
          <KPI label="Projected next 30d" value={`$${projected.toFixed(2)}`} tone={overBudget ? "danger" : "default"} />
          <KPI label="Monthly budget" value={`$${cfg.monthlyBudgetUsd.toFixed(0)}`} tone="ok" />
        </div>

        {overBudget && (
          <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Projected spend ${projected.toFixed(2)} exceeds monthly budget ${cfg.monthlyBudgetUsd.toFixed(0)}.
          </div>
        )}

        <SectionCard title="Log spend" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input placeholder="Feature" value={feature} onChange={(e) => setFeature(e.target.value)} />
            <Input placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input type="number" placeholder="Input tokens" value={inputTokens} onChange={(e) => setInputTokens(e.target.value)} />
            <Input type="number" placeholder="Output tokens" value={outputTokens} onChange={(e) => setOutputTokens(e.target.value)} />
            <Input type="number" step="0.01" placeholder="Cost USD" value={costUsd} onChange={(e) => setCostUsd(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Log</Button>
        </SectionCard>

        <SectionCard title="Monthly budget">
          <div className="flex items-center gap-3">
            <span className="text-sm text-sub">USD/month</span>
            <Input
              type="number"
              min="0"
              step="50"
              value={cfg.monthlyBudgetUsd}
              onChange={(e) => {
                // Only accept finite, non-negative values — empty/garbage input keeps the prior budget.
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) cfg.setBudget(v);
              }}
              className="max-w-[160px]"
            />
          </div>
        </SectionCard>

        {dailyData.length > 0 && (
          <SectionCard
            title="Daily spend"
            icon={CircleDollarSign}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="token-cost" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                  <ReferenceLine y={cfg.monthlyBudgetUsd / 30} stroke="#ff6b6b" strokeDasharray="4 4" label={{ value: "daily budget", position: "right", fill: "#ff6b6b", fontSize: 10 }} />
                  <Area dataKey="cost" stroke="#00f0ff" fill="#00f0ff20" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {featureBreakdown.length > 0 && (
          <SectionCard title="By feature" icon={CircleDollarSign}>
            <ul className="space-y-1 text-sm">
              {featureBreakdown.map((f) => (
                <li key={f.feature} className="flex justify-between">
                  <span>{f.feature}</span>
                  <span className="font-mono">${f.cost.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {list.length > 0 && (
          <SectionCard title={`Spend log (${list.length})`} icon={CircleDollarSign}>
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-sub uppercase">
                  <th className="p-2">Date</th><th className="p-2">Feature</th><th className="p-2">Model</th>
                  <th className="p-2 text-right">Tokens</th><th className="p-2 text-right">Cost</th><th className="p-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {[...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map((x) => (
                    <tr key={x.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{x.date}</td>
                      <td className="p-2">{x.feature}</td>
                      <td className="p-2 text-sub">{x.model}</td>
                      <td className="p-2 text-right font-mono text-xs">{(x.inputTokens + x.outputTokens).toLocaleString()}</td>
                      <td className="p-2 text-right font-mono">${x.costUsd.toFixed(2)}</td>
                      <td className="p-2"><button onClick={() => remove(x.id)} aria-label="Remove spend entry" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button></td>
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

function KPI({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "danger" }) {
  const colorClass = tone === "danger" ? "text-red-400" : tone === "ok" ? "text-emerald-400" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
