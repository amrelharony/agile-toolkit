"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { wsjfScore, rank } from "@/lib/analytics/scoring-rubric";
import { generateWsjfPrompts } from "@/lib/ai-prompts/wsjf";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WSJF_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function WsjfClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "wsjf"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("wsjf");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [bv, setBv] = useState("");
  const [tc, setTc] = useState("");
  const [rrOe, setRrOe] = useState("");
  const [size, setSize] = useState("");

  function add() {
    if (!title.trim()) return;
    const fn = (s: string, fb: number) => {
      const v = parseFloat(s);
      return Number.isFinite(v) ? v : fb;
    };
    const businessValue = fn(bv, 0);
    const timeCriticality = fn(tc, 0);
    const rrOeVal = fn(rrOe, 0);
    const jobSize = fn(size, 1);
    const score = wsjfScore(businessValue, timeCriticality, rrOeVal, jobSize);
    const item: PrioritizationItem = {
      id: crypto.randomUUID(), framework: "wsjf", title: title.trim().slice(0, 200),
      score,
      fields: { businessValue, timeCriticality, rrOe: rrOeVal, jobSize },
      status: "scored", updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(WSJF_ACTIONS.ITEM_ADDED, { title: item.title, score });
    emitSignal({ kind: "prioritization.scored", at: item.updatedAt, toolId: "wsjf", payload: { framework: "wsjf", id: item.id, score } });
    setTitle(""); setBv(""); setTc(""); setRrOe(""); setSize("");
  }

  const ranked = useMemo(() => rank(items.map((x) => ({
    id: x.id, title: x.title, fields: x.fields ?? {}, score: x.score ?? 0,
  }))), [items]);

  const chartData = ranked.slice(0, 10).map((r) => ({ title: r.title.length > 18 ? r.title.slice(0, 18) + "…" : r.title, score: Number(r.score.toFixed(2)) }));

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    prioritizations: s.prioritizations,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "WSJF Calculator",
    prompts: generateWsjfPrompts({ items: ranked }, workspace),
  }), [ranked, workspace]);

  const csvData = {
    headers: ["Rank", "Title", "BV", "TC", "RR/OE", "Size", "WSJF"],
    rows: ranked.map((r) => [r.rank, r.title, r.fields.businessValue ?? "", r.fields.timeCriticality ?? "", r.fields.rrOe ?? "", r.fields.jobSize ?? "", r.score.toFixed(2)]),
  };

  return (
    <ToolPageWrapper
      toolId="wsjf"
      title="WSJF Calculator"
      description="Weighted Shortest Job First: (Business Value + Time Criticality + Risk Reduction/Opportunity Enablement) ÷ Job Size."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add feature" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <Input className="sm:col-span-2" placeholder="Feature title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="number" placeholder="Business Value" value={bv} onChange={(e) => setBv(e.target.value)} />
            <Input type="number" placeholder="Time Criticality" value={tc} onChange={(e) => setTc(e.target.value)} />
            <Input type="number" placeholder="RR/OE" value={rrOe} onChange={(e) => setRrOe(e.target.value)} />
            <Input type="number" placeholder="Job Size" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add & score</Button>
        </SectionCard>

        {chartData.length > 0 && (
          <SectionCard title="Top 10 by WSJF"
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="wsjf-scores" csvData={csvData} jsonData={ranked} targetRef={exportRef} />
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
                  <Bar dataKey="score" fill="#9d4edd" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {ranked.length > 0 && (
          <SectionCard title="Features (sorted by WSJF)">
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-sub uppercase">
                  <th className="p-2">#</th><th className="p-2">Title</th>
                  <th className="p-2 text-right">BV</th><th className="p-2 text-right">TC</th>
                  <th className="p-2 text-right">RR/OE</th><th className="p-2 text-right">Size</th>
                  <th className="p-2 text-right">WSJF</th><th className="p-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{r.rank}</td><td className="p-2">{r.title}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.businessValue}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.timeCriticality}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.rrOe}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.jobSize}</td>
                      <td className="p-2 text-right font-mono">{r.score.toFixed(2)}</td>
                      <td className="p-2"><button onClick={() => { removeOne(r.id); log(WSJF_ACTIONS.ITEM_REMOVED, { id: r.id }); }} aria-label="Remove feature" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button></td>
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
