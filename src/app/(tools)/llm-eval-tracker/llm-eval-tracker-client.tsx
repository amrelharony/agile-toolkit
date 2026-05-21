"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { Brain, Plus, Trash2, AlertTriangle, TrendingDown } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LLMEval, Workspace } from "@/lib/stores/workspace-types";
import { detectRegressions } from "@/lib/analytics/eval-regression";
import { generateLLMEvalPrompts } from "@/lib/ai-prompts/llm-eval-tracker";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { LLM_EVAL_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const COLORS = ["#00f0ff", "#ff00aa", "#00ff88", "#ffaa00", "#9d4edd", "#ff6b6b"];

export function LLMEvalTrackerClient() {
  const evals = useWorkspaceStore((s) => s.llmEvals ?? []);
  const upsertLLMEval = useWorkspaceStore((s) => s.upsertLLMEval);
  const removeLLMEval = useWorkspaceStore((s) => s.removeLLMEval);
  const { log } = useHistoryLogger("llm-eval-tracker");
  const exportRef = useRef<HTMLDivElement>(null);

  const [model, setModel] = useState("");
  const [dataset, setDataset] = useState("");
  const [score, setScore] = useState("");
  const [promptVersion, setPromptVersion] = useState("");

  function addEval() {
    const sc = parseFloat(score);
    if (!model.trim() || !dataset.trim() || !Number.isFinite(sc)) return;
    const item: LLMEval = {
      id: crypto.randomUUID(),
      model: model.trim(),
      dataset: dataset.trim(),
      score: Math.max(0, Math.min(1, sc)),
      promptVersion: promptVersion.trim() || undefined,
      recordedAt: new Date().toISOString(),
    };
    upsertLLMEval(item);
    log(LLM_EVAL_ACTIONS.EVAL_LOGGED, { model: item.model, score: item.score });
    emitSignal({ kind: "llmEval.recorded", at: item.recordedAt, toolId: "llm-eval-tracker", payload: item });
    setScore("");
  }

  function remove(id: string) {
    removeLLMEval(id);
    log(LLM_EVAL_ACTIONS.EVAL_REMOVED, { id });
  }

  // Group eval samples by `${prompt}|${dataset}` so detectRegressions works.
  const regressionFindings = useMemo(() => {
    const samples = evals.map((e) => ({
      group: `${e.promptVersion ?? "default"}|${e.dataset}`,
      score: e.score,
      recordedAt: e.recordedAt,
    }));
    return detectRegressions(samples, { minSamples: 3, recentWindow: 3, minConfidence: 0.7 });
  }, [evals]);

  // Emit `llmEval.regressionDetected` exactly once per (group, delta) so
  // downstream tools (hallucination-log, model-migration) can react.
  //
  // R5: previously the dedupe set was a useRef → cleared on every hard
  // reload, so the same regression re-fired (and re-notified downstream
  // consumers) at every page load. Persist the dedupe set in
  // localStorage so it survives reloads. Cap the persisted set at a
  // reasonable size — old entries roll off naturally.
  const DEDUPE_KEY = "agile-toolkit:llm-eval:emitted-regressions:v1";
  const DEDUPE_CAP = 500;
  const emittedRegressionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DEDUPE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) emittedRegressionsRef.current = new Set(parsed.filter((x): x is string => typeof x === "string"));
      }
    } catch { /* corrupted or quota — fresh start */ }
  }, []);
  useEffect(() => {
    let added = false;
    for (const f of regressionFindings) {
      // R11-fix: include the recent + baseline means in the key so
      // re-deletion / re-detection of the same group+delta combo
      // doesn't silently swallow a fresh regression. The previous
      // `${group}|${delta.toFixed(3)}` key was identical for any
      // regression that happened to land on the same delta rounding
      // (e.g. deleting then re-adding a regressing eval pair with
      // similar but distinct values produced a hash collision; the
      // second regression never emitted a signal).
      const key = [
        f.group,
        f.delta.toFixed(3),
        // Use whatever the finding offers as additional dimensions —
        // these are typed loosely on the finding object, so cast
        // through Record to a forgiving lookup.
        (f as unknown as { recentMean?: number }).recentMean?.toFixed(3) ?? "",
        (f as unknown as { baselineMean?: number }).baselineMean?.toFixed(3) ?? "",
      ].join("|");
      if (emittedRegressionsRef.current.has(key)) continue;
      emittedRegressionsRef.current.add(key);
      added = true;
      emitSignal({
        kind: "llmEval.regressionDetected",
        at: new Date().toISOString(),
        toolId: "llm-eval-tracker",
        payload: f,
      });
    }
    if (added && typeof window !== "undefined") {
      try {
        // Cap by keeping only the most recent N entries (Set preserves
        // insertion order so this is "newest N").
        const arr = Array.from(emittedRegressionsRef.current);
        const capped = arr.length > DEDUPE_CAP ? arr.slice(arr.length - DEDUPE_CAP) : arr;
        if (capped.length !== arr.length) emittedRegressionsRef.current = new Set(capped);
        window.localStorage.setItem(DEDUPE_KEY, JSON.stringify(capped));
      } catch { /* SecurityError / quota — silently drop */ }
    }
  }, [regressionFindings]);

  // Build chart data: one series per dataset, x = chronological index.
  // Recharts treats `dataKey` as a lodash get-path (a.b.c reaches point.a.b.c),
  // so any user-typed dataset name with a `.` or `[` would silently fail to
  // resolve. We assign each dataset a synthetic sanitized key and keep a
  // parallel label lookup for the legend / tooltips.
  const datasetSeries = useMemo(() => {
    const names = Array.from(new Set(evals.map((e) => e.dataset)));
    return names.map((name, i) => ({ key: `ds${i}`, label: name }));
  }, [evals]);

  const chartData = useMemo(() => {
    const keyByName = new Map(datasetSeries.map((d) => [d.label, d.key]));
    const sorted = [...evals].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
    return sorted.map((e, i) => {
      const point: Record<string, string | number> = {
        idx: i + 1,
        date: e.recordedAt.slice(0, 10),
      };
      const k = keyByName.get(e.dataset);
      if (k) point[k] = e.score;
      return point;
    });
  }, [evals, datasetSeries]);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
        impediments: s.impediments, risks: s.risks, okrs: s.okrs,
        decisions: s.decisions, techDebt: s.techDebt,
        maturityLevel: s.maturityLevel, teamName: s.teamName,
        llmEvals: s.llmEvals, prompts: s.prompts, hallucinations: s.hallucinations,
        models: s.models,
      })
    )
  );

  const promptConfig = useMemo(() => ({
    toolName: "LLM Eval Tracker",
    prompts: generateLLMEvalPrompts({ evals, regressions: regressionFindings }, workspace),
  }), [evals, regressionFindings, workspace]);

  const csvData = {
    headers: ["Date", "Model", "Dataset", "Prompt Version", "Score"],
    rows: evals.map((e) => [e.recordedAt.slice(0, 10), e.model, e.dataset, e.promptVersion ?? "", e.score]),
  };

  const recentMean = evals.length === 0 ? 0 : evals.slice(-5).reduce((s, e) => s + e.score, 0) / Math.min(5, evals.length);

  return (
    <ToolPageWrapper
      toolId="llm-eval-tracker"
      title="LLM Eval Tracker"
      description="Log eval scores per (model, dataset, prompt-version). Charts show drift over time and surface statistically-significant regressions."
    >
      <div ref={exportRef} className="space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total runs" value={String(evals.length)} />
          <KPI label="Datasets" value={String(datasetSeries.length)} />
          <KPI label="Last 5 mean" value={(recentMean * 100).toFixed(1) + "%"} />
          <KPI
            label="Regressions"
            value={String(regressionFindings.length)}
            tone={regressionFindings.length > 0 ? "danger" : "ok"}
          />
        </div>

        {/* Regression alerts */}
        {regressionFindings.length > 0 && (
          <SectionCard title="Detected regressions" icon={TrendingDown} iconClassName="text-red-400">
            <ul className="space-y-2 text-sm">
              {regressionFindings.map((f) => (
                <li
                  key={f.group}
                  className="flex items-center justify-between border border-red-500/30 bg-red-500/5 rounded p-2"
                >
                  <span className="text-text">
                    <span className="font-mono text-xs text-sub">{f.group}</span>
                    {" — "}
                    {(f.baselineMean * 100).toFixed(1)}% → {(f.recentMean * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs text-red-300">
                    Δ {(f.delta * 100).toFixed(1)} pts · t={f.tStat.toFixed(2)} · {(f.confidence * 100).toFixed(0)}% conf
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* Add new eval */}
        <SectionCard title="Log eval run" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <Input
              placeholder="Model (e.g. gpt-5)"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Input
              placeholder="Dataset (e.g. faithfulness-v2)"
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            />
            <Input
              placeholder="Prompt version (optional)"
              value={promptVersion}
              onChange={(e) => setPromptVersion(e.target.value)}
            />
            <Input
              type="number"
              step="0.001"
              min="0"
              max="1"
              placeholder="Score 0–1"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
            <Button onClick={addEval} className="gap-1">
              <Plus className="w-4 h-4" /> Log
            </Button>
          </div>
        </SectionCard>

        {/* Chart */}
        {chartData.length > 0 && (
          <SectionCard
            title="Score over time"
            icon={Brain}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="llm-evals"
                  csvData={csvData}
                  jsonData={evals}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#888" fontSize={11} />
                  <YAxis domain={[0, 1]} stroke="#888" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f1117",
                      border: "1px solid #2a2f3a",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0.8} stroke="#00ff88" strokeDasharray="4 4" />
                  {datasetSeries.map((d, i) => (
                    <Line
                      key={d.key}
                      dataKey={d.key}
                      name={d.label}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      // R10: do NOT connectNulls. Most rows for a series
                      // have `undefined` (only a single eval per date).
                      // Bridging across undefined draws a smooth line
                      // over weeks of no measurement, falsely implying
                      // continuous data.
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {/* Table */}
        {evals.length > 0 && (
          <SectionCard title={`Eval log (${evals.length})`} icon={AlertTriangle}>
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">Date</th>
                    <th className="p-2">Model</th>
                    <th className="p-2">Dataset</th>
                    <th className="p-2">Prompt v</th>
                    <th className="p-2 text-right">Score</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...evals]
                    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
                    .map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="p-2 font-mono text-xs">{e.recordedAt.slice(0, 10)}</td>
                        <td className="p-2">{e.model}</td>
                        <td className="p-2 text-sub">{e.dataset}</td>
                        <td className="p-2 font-mono text-xs">{e.promptVersion ?? "—"}</td>
                        <td className="p-2 text-right font-mono">{(e.score * 100).toFixed(1)}%</td>
                        <td className="p-2">
                          <button
                            onClick={() => remove(e.id)}
                            className="text-sub hover:text-red-400"
                            aria-label="Remove eval"
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

function KPI({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "danger" }) {
  const colorClass = tone === "danger" ? "text-red-400" : tone === "ok" ? "text-emerald-400" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
