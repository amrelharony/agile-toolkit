"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { Brain, Plus, Trash2, AlertTriangle, TrendingDown, Beaker, Sparkles } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LLMEval, Workspace } from "@/lib/stores/workspace-types";
import { detectRegressions } from "@/lib/analytics/eval-regression";
import { generateLLMEvalPrompts } from "@/lib/ai-prompts/llm-eval-tracker";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { LLM_EVAL_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { toast } from "@/lib/utils/toast";

// Lazy-loaded — the BYOK adapter chunks should never land in the eager
// bundle of users who only manually log scores.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2 border border-border rounded">Loading panel…</div>
  ),
});

// Recharts loads with the score chart, not the page.
const ScoreOverTimeChart = dynamic(() => import("./charts").then((m) => m.ScoreOverTimeChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** recordedAt as epoch ms; an unparseable timestamp (record_eval accepts any
 *  string) counts as the oldest so it can't make a sort comparator
 *  non-transitive and scramble the valid rows. */
function recordedMs(e: LLMEval): number {
  const t = new Date(e.recordedAt).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}
function byRecordedAtAsc(a: LLMEval, b: LLMEval): number {
  const ta = recordedMs(a);
  const tb = recordedMs(b);
  return ta === tb ? 0 : ta - tb;
}

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

  // --- Live Eval Run state ---
  // BYOK active provider/model — single shot here (A/B comparison lives in
  // /model-comparison's Live Compare section). Reads from the same hook the
  // header chip uses so it auto-updates when settings change.
  const llm = useActiveLlm();
  const [liveDataset, setLiveDataset] = useState("");
  const [livePromptVersion, setLivePromptVersion] = useState("");
  const [livePrompt, setLivePrompt] = useState("");
  const [liveScore, setLiveScore] = useState("");

  function logLiveScore() {
    const sc = parseFloat(liveScore);
    if (!liveDataset.trim()) {
      toast.error("Set a dataset name first");
      return;
    }
    if (!Number.isFinite(sc) || sc < 0 || sc > 1) {
      toast.error("Score must be a number between 0 and 1");
      return;
    }
    if (!llm.model) {
      toast.error("No active AI provider");
      return;
    }
    const item: LLMEval = {
      id: crypto.randomUUID(),
      // Use the actual provider model id so future analytics can match
      // against MODELS_BY_PROVIDER. The user typed nothing; we pull it from
      // the BYOK store directly.
      model: llm.model,
      dataset: liveDataset.trim(),
      score: sc,
      promptVersion: livePromptVersion.trim() || undefined,
      recordedAt: new Date().toISOString(),
    };
    upsertLLMEval(item);
    log(LLM_EVAL_ACTIONS.EVAL_LOGGED, { model: item.model, score: item.score });
    emitSignal({
      kind: "llmEval.recorded",
      at: item.recordedAt,
      toolId: "llm-eval-tracker",
      payload: item,
    });
    toast.success(`Logged ${(item.score * 100).toFixed(0)}% for ${item.model} on ${item.dataset}`);
    // Clear only the score so the user can iterate (re-run, re-grade) on
    // the same prompt without re-typing dataset + prompt + version.
    setLiveScore("");
  }

  function addEval() {
    const sc = parseFloat(score);
    if (!model.trim() || !dataset.trim() || !Number.isFinite(sc) || sc < 0 || sc > 1) return;
    const item: LLMEval = {
      id: crypto.randomUUID(),
      model: model.trim(),
      dataset: dataset.trim(),
      score: sc,
      promptVersion: promptVersion.trim() || undefined,
      recordedAt: new Date().toISOString(),
    };
    upsertLLMEval(item);
    log(LLM_EVAL_ACTIONS.EVAL_LOGGED, { model: item.model, score: item.score });
    emitSignal({
      kind: "llmEval.recorded",
      at: item.recordedAt,
      toolId: "llm-eval-tracker",
      payload: item,
    });
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
        if (Array.isArray(parsed))
          emittedRegressionsRef.current = new Set(
            parsed.filter((x): x is string => typeof x === "string")
          );
      }
    } catch {
      /* corrupted or quota — fresh start */
    }
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
      } catch {
        /* SecurityError / quota — silently drop */
      }
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

  // Oldest → newest by recordedAt. Store order is arrival order, which an
  // agent backfill or a sync pull can make anything but chronological.
  const chronological = useMemo(() => [...evals].sort(byRecordedAtAsc), [evals]);

  const chartData = useMemo(() => {
    const keyByName = new Map(datasetSeries.map((d) => [d.label, d.key]));
    return chronological.map((e, i) => {
      const point: Record<string, string | number> = {
        idx: i + 1,
        date: e.recordedAt.slice(0, 10),
      };
      const k = keyByName.get(e.dataset);
      if (k) point[k] = e.score;
      return point;
    });
  }, [chronological, datasetSeries]);

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
        llmEvals: s.llmEvals,
        prompts: s.prompts,
        hallucinations: s.hallucinations,
        models: s.models,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "LLM Eval Tracker",
      prompts: generateLLMEvalPrompts({ evals, regressions: regressionFindings }, workspace),
    }),
    [evals, regressionFindings, workspace]
  );

  const csvData = {
    headers: ["Date", "Model", "Dataset", "Prompt Version", "Score"],
    rows: evals.map((e) => [
      e.recordedAt.slice(0, 10),
      e.model,
      e.dataset,
      e.promptVersion ?? "",
      e.score,
    ]),
  };

  // "Last 5" = the five most recent runs by recordedAt, not the last five
  // rows in store order.
  const lastFive = chronological.slice(-5);
  const recentMean =
    lastFive.length === 0 ? 0 : lastFive.reduce((s, e) => s + e.score, 0) / lastFive.length;

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
          <SectionCard title="Detected regressions" icon={TrendingDown} iconClassName="text-danger">
            <ul className="space-y-2 text-sm">
              {regressionFindings.map((f) => (
                <li
                  key={f.group}
                  className="flex items-center justify-between border border-danger/30 bg-danger/5 rounded p-2"
                >
                  <span className="text-text">
                    <span className="font-mono text-xs text-sub">{f.group}</span>
                    {" — "}
                    {(f.baselineMean * 100).toFixed(1)}% → {(f.recentMean * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs text-danger">
                    Δ {(f.delta * 100).toFixed(1)} pts · t=
                    {Number.isFinite(f.tStat) ? f.tStat.toFixed(2) : "∞"} ·{" "}
                    {(f.confidence * 100).toFixed(0)}% conf
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* Live Eval Run (BYOK) — close the loop: write a prompt, run it via
            your active provider, grade the output, auto-log the score. Sits
            above the manual entry card because once you've configured a
            provider this is the faster path. */}
        <SectionCard title="Live Eval Run (BYOK)" icon={Beaker}>
          <p className="text-xs text-sub mb-3">
            Run a prompt against your active BYOK provider, read the streamed output, then grade it.
            The score is logged against the provider&apos;s actual model id, so it lines up with the
            rest of your eval history.
          </p>
          {!llm.isReady ? (
            <div className="flex flex-col items-start gap-2 p-4 border border-dashed border-border rounded text-sub text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-accent" />
                No BYOK provider configured yet.
              </span>
              <Button size="sm" variant="outline" onClick={llm.openSettings} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Open AI settings
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <Input
                  placeholder="Dataset name (e.g. faithfulness-v2)"
                  aria-label="Dataset name"
                  value={liveDataset}
                  onChange={(e) => setLiveDataset(e.target.value)}
                />
                <Input
                  placeholder="Prompt version (optional, e.g. greet@1.4.0)"
                  aria-label="Prompt version (optional)"
                  value={livePromptVersion}
                  onChange={(e) => setLivePromptVersion(e.target.value)}
                />
              </div>
              <Textarea
                value={livePrompt}
                onChange={(e) => setLivePrompt(e.target.value)}
                placeholder="The prompt to test…"
                aria-label="Prompt to test"
                rows={4}
                className="font-mono text-xs"
              />
              {/* AiRunPanel renders only when a prompt is typed, otherwise
                  it would show a Run button that no-ops on empty input. */}
              {livePrompt.trim().length > 0 && (
                <div className="mt-3">
                  <AiRunPanel prompt={livePrompt} toolName="LLM Eval Tracker (live)" />
                </div>
              )}
              {/* Grade strip — always visible so the user grasps the full
                  flow at a glance, even before they've run anything. */}
              <div className="mt-3 flex items-end gap-2 flex-wrap">
                <div className="flex flex-col gap-1 min-w-[8rem]">
                  <label
                    htmlFor="live-eval-score"
                    className="text-xs uppercase tracking-wider text-sub font-mono"
                  >
                    Score 0–1
                  </label>
                  <Input
                    id="live-eval-score"
                    type="number"
                    step="0.001"
                    min="0"
                    max="1"
                    placeholder="0.85"
                    value={liveScore}
                    onChange={(e) => setLiveScore(e.target.value)}
                  />
                </div>
                <Button onClick={logLiveScore} className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  Log score for {llm.providerName ?? "active provider"}
                </Button>
                <span className="text-xs text-sub">
                  Model: <span className="font-mono">{llm.model ?? "—"}</span>
                </span>
              </div>
            </>
          )}
        </SectionCard>

        {/* Add new eval */}
        <SectionCard title="Log eval run" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <Input
              placeholder="Model (e.g. gpt-5)"
              aria-label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Input
              placeholder="Dataset (e.g. faithfulness-v2)"
              aria-label="Dataset"
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            />
            <Input
              placeholder="Prompt version (optional)"
              aria-label="Prompt version (optional)"
              value={promptVersion}
              onChange={(e) => setPromptVersion(e.target.value)}
            />
            <Input
              type="number"
              step="0.001"
              min="0"
              max="1"
              placeholder="Score 0–1"
              aria-label="Score 0–1"
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
              <ScoreOverTimeChart data={chartData} series={datasetSeries} />
            </div>
          </SectionCard>
        )}

        {/* Table */}
        {evals.length > 0 && (
          <SectionCard title={`Eval log (${evals.length})`} icon={AlertTriangle}>
            <div className="table-wrap-responsive">
              <table className="w-full min-w-full md:min-w-[600px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">Date</th>
                    <th className="p-2">Model</th>
                    <th className="p-2">Dataset</th>
                    <th className="p-2">Prompt v</th>
                    <th className="p-2 text-right">Score</th>
                    <th className="p-2 w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...evals]
                    .sort((a, b) => byRecordedAtAsc(b, a))
                    .map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="p-2 font-mono text-xs">{e.recordedAt.slice(0, 10)}</td>
                        <td className="p-2">{e.model}</td>
                        <td className="p-2 text-sub">{e.dataset}</td>
                        <td className="p-2 font-mono text-xs">{e.promptVersion ?? "—"}</td>
                        <td className="p-2 text-right font-mono">{(e.score * 100).toFixed(1)}%</td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => remove(e.id)}
                            className="text-sub hover:text-danger min-touch-coarse inline-flex items-center justify-center"
                            aria-label={`Remove eval: ${e.model} on ${e.dataset}`}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
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

function KPI({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
}) {
  const colorClass =
    tone === "danger" ? "text-danger" : tone === "ok" ? "text-success" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
