"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Calculator, Plus, Trash2, AlertTriangle } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { riceScore, rank, detectOutliers } from "@/lib/analytics/scoring-rubric";
import { generateRicePrompts } from "@/lib/ai-prompts/rice-scoring";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RICE_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function RiceScoringClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "rice"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("rice-scoring");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [reach, setReach] = useState("");
  const [impact, setImpact] = useState("");
  const [confidence, setConfidence] = useState("");
  const [effort, setEffort] = useState("");

  function add() {
    if (!title.trim()) return;
    // Use `Number` (strict) rather than `parseFloat` so "5abc" → NaN → fallback,
    // not "5abc" → 5. Empty string → NaN → fallback.
    const fn = (s: string, fb: number) => {
      const v = s.trim() === "" ? NaN : Number(s);
      return Number.isFinite(v) ? v : fb;
    };
    const r = fn(reach, 0);
    const i = fn(impact, 0);
    const c = fn(confidence, 100);
    const e = fn(effort, 1);
    const score = riceScore(r, i, c, e);
    const item: PrioritizationItem = {
      id: crypto.randomUUID(),
      framework: "rice",
      title: title.trim().slice(0, 200),
      score,
      fields: { reach: r, impact: i, confidence: c, effort: e },
      status: "scored",
      updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(RICE_ACTIONS.ITEM_ADDED, { title: item.title, score });
    emitSignal({
      kind: "prioritization.scored",
      at: item.updatedAt,
      toolId: "rice-scoring",
      payload: { framework: "rice", id: item.id, score },
    });
    setTitle("");
    setReach("");
    setImpact("");
    setConfidence("");
    setEffort("");
  }

  function remove(id: string) {
    removeOne(id);
    log(RICE_ACTIONS.ITEM_REMOVED, { id });
  }

  const ranked = useMemo(
    () =>
      rank(
        items.map((x) => ({
          id: x.id,
          title: x.title,
          fields: x.fields ?? {},
          score: x.score ?? 0,
        }))
      ),
    [items]
  );

  const outliers = useMemo(
    () =>
      detectOutliers(
        items.map((x) => ({
          id: x.id,
          title: x.title,
          fields: x.fields ?? {},
          score: x.score ?? 0,
        }))
      ),
    [items]
  );

  const chartData = ranked
    .slice(0, 10)
    .map((r) => ({
      title: r.title.length > 20 ? r.title.slice(0, 20) + "…" : r.title,
      score: Number(r.score.toFixed(2)),
    }));

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
        prioritizations: s.prioritizations,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "RICE Scoring",
      prompts: generateRicePrompts({ items: ranked, outliers: Array.from(outliers) }, workspace),
    }),
    [ranked, outliers, workspace]
  );

  const csvData = {
    headers: ["Rank", "Title", "Reach", "Impact", "Confidence%", "Effort", "Score"],
    rows: ranked.map((r) => [
      r.rank,
      r.title,
      r.fields.reach ?? "",
      r.fields.impact ?? "",
      r.fields.confidence ?? "",
      r.fields.effort ?? "",
      r.score.toFixed(2),
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="rice-scoring"
      title="RICE Scoring Calculator"
      description="Score initiatives by Reach × Impact × Confidence ÷ Effort. Outliers (suspicious scores) are flagged for re-check."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add initiative" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <Input
              className="sm:col-span-2"
              placeholder="Initiative title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Reach (people/qtr)"
              value={reach}
              onChange={(e) => setReach(e.target.value)}
            />
            <Input
              type="number"
              step="0.1"
              placeholder="Impact 0.25–3"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Confidence 0–100%"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            />
            <Input
              type="number"
              step="0.5"
              placeholder="Effort (person-mo)"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
            />
          </div>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add & score
          </Button>
        </SectionCard>

        {chartData.length > 0 && (
          <SectionCard
            title="Top 10 by RICE score"
            icon={Calculator}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="rice-scores"
                  csvData={csvData}
                  jsonData={ranked}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="#888" fontSize={11} />
                  <YAxis type="category" dataKey="title" stroke="#888" fontSize={11} width={150} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f1117",
                      border: "1px solid #2a2f3a",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="score" fill="#00f0ff" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {ranked.length > 0 && (
          <SectionCard title={`Initiatives (${ranked.length}, sorted by RICE)`}>
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">#</th>
                    <th className="p-2">Title</th>
                    <th className="p-2 text-right">R</th>
                    <th className="p-2 text-right">I</th>
                    <th className="p-2 text-right">C%</th>
                    <th className="p-2 text-right">E</th>
                    <th className="p-2 text-right">Score</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-t border-border ${outliers.has(r.id) ? "bg-amber-500/5" : ""}`}
                    >
                      <td className="p-2 font-mono text-xs">{r.rank}</td>
                      <td className="p-2 flex items-center gap-2">
                        {r.title}{" "}
                        {outliers.has(r.id) && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.reach}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.impact}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.confidence}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.effort}</td>
                      <td className="p-2 text-right font-mono">{r.score.toFixed(2)}</td>
                      <td className="p-2">
                        <button
                          onClick={() => remove(r.id)}
                          aria-label="Remove item"
                          className="text-sub hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
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
