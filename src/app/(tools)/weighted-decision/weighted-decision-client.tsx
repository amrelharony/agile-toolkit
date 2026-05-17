"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { PercentCircle, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WeightedCriterion, WeightedOption, Workspace } from "@/lib/stores/workspace-types";
import { weightedScore } from "@/lib/analytics/scoring-rubric";
import { generateWeightedPrompts } from "@/lib/ai-prompts/weighted-decision";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WEIGHTED_DECISION_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function WeightedDecisionClient() {
  const criteria = useWorkspaceStore((s) => s.weightedCriteria ?? []);
  const options = useWorkspaceStore((s) => s.weightedOptions ?? []);
  const upsertCriterion = useWorkspaceStore((s) => s.upsertWeightedCriterion);
  const removeCriterion = useWorkspaceStore((s) => s.removeWeightedCriterion);
  const upsertOption = useWorkspaceStore((s) => s.upsertWeightedOption);
  const removeOption = useWorkspaceStore((s) => s.removeWeightedOption);
  const { log } = useHistoryLogger("weighted-decision");
  const exportRef = useRef<HTMLDivElement>(null);

  const [criterionName, setCriterionName] = useState("");
  const [criterionWeight, setCriterionWeight] = useState("1");
  const [optionName, setOptionName] = useState("");

  function addCriterion() {
    if (!criterionName.trim()) return;
    // `parseFloat("0") || 1` collapses an explicit 0 (a temporarily-disabled
    // criterion held in the matrix) to weight 1 — the operator would then
    // appear to "ignore" the weight box. Coerce with Number.isFinite so
    // intentional zeros survive. We still floor at 0 to keep the bar chart
    // and total honest.
    const wRaw = parseFloat(criterionWeight);
    const weight = Number.isFinite(wRaw) ? Math.max(0, wRaw) : 1;
    const c: WeightedCriterion = { id: crypto.randomUUID(), name: criterionName.trim(), weight };
    upsertCriterion(c);
    log(WEIGHTED_DECISION_ACTIONS.CRITERION_ADDED, { name: c.name });
    setCriterionName(""); setCriterionWeight("1");
  }

  function removeCriterionCascade(criterionId: string) {
    // Cascade: drop the criterion's score from every option so re-adding a
    // criterion with the same name doesn't resurrect stale scores.
    removeCriterion(criterionId);
    for (const o of options) {
      if (criterionId in o.scores) {
        const next = { ...o.scores };
        delete next[criterionId];
        upsertOption({ ...o, scores: next });
      }
    }
    log(WEIGHTED_DECISION_ACTIONS.CRITERION_REMOVED, { id: criterionId });
  }

  function addOption() {
    if (!optionName.trim()) return;
    const o: WeightedOption = { id: crypto.randomUUID(), name: optionName.trim(), scores: {} };
    upsertOption(o);
    log(WEIGHTED_DECISION_ACTIONS.OPTION_ADDED, { name: o.name });
    setOptionName("");
  }

  function setScore(o: WeightedOption, criterionId: string, n: number) {
    upsertOption({ ...o, scores: { ...o.scores, [criterionId]: n } });
    log(WEIGHTED_DECISION_ACTIONS.SCORE_CHANGED, { optionId: o.id, criterionId, n });
    emitSignal({ kind: "decision.weightedScored", at: new Date().toISOString(), toolId: "weighted-decision", payload: { optionId: o.id, criterionId } });
  }

  const weights = useMemo(() => Object.fromEntries(criteria.map((c) => [c.id, c.weight])), [criteria]);
  const ranked = useMemo(() => {
    return [...options]
      .map((o) => ({ ...o, score: weightedScore(o.scores, weights) }))
      .sort((a, b) => b.score - a.score);
  }, [options, weights]);

  const chartData = ranked.map((o) => ({ name: o.name.length > 18 ? o.name.slice(0, 18) + "…" : o.name, score: Number(o.score.toFixed(2)) }));

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    weightedCriteria: s.weightedCriteria, weightedOptions: s.weightedOptions,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Weighted Decision Matrix",
    prompts: generateWeightedPrompts({ criteria, ranked }, workspace),
  }), [criteria, ranked, workspace]);

  const csvData = {
    headers: ["Option", ...criteria.map((c) => `${c.name} (w${c.weight})`), "Total"],
    rows: ranked.map((o) => [o.name, ...criteria.map((c) => o.scores[c.id] ?? 0), o.score.toFixed(2)]),
  };

  return (
    <ToolPageWrapper
      toolId="weighted-decision"
      title="Weighted Decision Matrix (Pugh / MCDA)"
      description="Score each option against weighted criteria. Total = sum(score × weight). Best for choosing between similar competitors."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Criteria">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Criterion name" value={criterionName} onChange={(e) => setCriterionName(e.target.value)} />
            <Input type="number" step="0.5" placeholder="Weight" value={criterionWeight} onChange={(e) => setCriterionWeight(e.target.value)} />
            <Button onClick={addCriterion} className="gap-1"><Plus className="w-4 h-4" />Add criterion</Button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {criteria.map((c) => (
              <li key={c.id} className="text-xs bg-surface-deep border border-border rounded px-2 py-1 flex items-center gap-1">
                {c.name} <span className="text-sub">w{c.weight}</span>
                <button onClick={() => removeCriterionCascade(c.id)} className="text-sub hover:text-red-400 ml-1" aria-label={`Remove criterion ${c.name}`}><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Options">
          <div className="flex gap-2">
            <Input placeholder="Option name" value={optionName} onChange={(e) => setOptionName(e.target.value)} />
            <Button onClick={addOption} className="gap-1"><Plus className="w-4 h-4" />Add option</Button>
          </div>
        </SectionCard>

        {options.length > 0 && criteria.length > 0 && (
          <SectionCard
            title="Scoring matrix"
            icon={PercentCircle}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="weighted-decision" csvData={csvData} jsonData={{ criteria, options: ranked }} targetRef={exportRef} />
              </>
            }
          >
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-sub uppercase">
                  <th className="p-2">Option</th>
                  {criteria.map((c) => <th key={c.id} className="p-2 text-center">{c.name} <span className="text-sub">×{c.weight}</span></th>)}
                  <th className="p-2 text-right">Total</th><th className="p-2 w-10"></th>
                </tr></thead>
                <tbody>
                  {ranked.map((o, i) => (
                    <tr key={o.id} className={`border-t border-border ${i === 0 ? "bg-emerald-500/5" : ""}`}>
                      <td className="p-2">{o.name}{i === 0 && <span className="ml-1 text-emerald-400 text-xs">★</span>}</td>
                      {criteria.map((c) => (
                        <td key={c.id} className="p-1 text-center">
                          <Input
                            type="number"
                            value={o.scores[c.id] ?? ""}
                            // R5: `|| 0` collapsed an explicit user-typed `0`
                            // (a valid score) and silently stored 0 for
                            // junk like "abc". Treat non-finite as 0 but
                            // preserve legitimate 0 entries.
                            onChange={(e) => { const n = parseFloat(e.target.value); setScore(o, c.id, Number.isFinite(n) ? n : 0); }}
                            className="h-7 w-16 text-center text-xs"
                          />
                        </td>
                      ))}
                      <td className="p-2 text-right font-mono">{o.score.toFixed(2)}</td>
                      <td className="p-2"><button onClick={() => { removeOption(o.id); log(WEIGHTED_DECISION_ACTIONS.OPTION_REMOVED, { id: o.id }); }} className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {chartData.length > 0 && (
          <SectionCard title="Total score">
            <div className="-mx-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="#888" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={11} width={150} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                  <Bar dataKey="score" fill="#00ff88" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
