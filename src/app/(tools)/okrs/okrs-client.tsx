"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartCard } from "@/components/shared/chart-card";
import { SmartInput } from "@/components/shared/smart-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Flag, Plus, Trash2, Target } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Okr, KeyResult } from "@/lib/stores/workspace-types";
// Note: a previous Holt-only `forecastLinear` against KR-index was removed
// because that ordering is editorial. We bring forecasting back with the
// Bayesian Holt primitive, but **only** apply it to per-OKR KR-progress
// series with a clear "across KR sequence" caveat in the UI — never as a
// dishonest "over time" projection.
import {
  forecastBayesianHolt,
  bayesianForecastConfidence,
} from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import { cusum } from "@/lib/analytics/changepoint";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { generateOkrsPrompts } from "@/lib/ai-prompts/okrs";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { OKR_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
// usePersisted no longer used — workspace store is the single source of truth.

/**
 * Numeric input with a string draft buffer so typing a multi-digit value
 * doesn't snap mid-edit (e.g. typing "1500" wouldn't briefly show "1" → "15"
 * → "150" coerced through Number()). Commits on blur or Enter.
 */
function NumCell({
  value,
  onChange,
  min,
  max,
  className,
  placeholder,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className}
      placeholder={placeholder}
      title={title}
    />
  );
}

function emptyKr(): KeyResult {
  return { id: nanoid(6), title: "", target: 100, current: 0, confidence: 5 };
}

function emptyOkr(): Okr {
  return {
    id: nanoid(8),
    objective: "",
    keyResults: [emptyKr()],
    quarter: currentQuarter(),
  };
}

function currentQuarter(): string {
  const now = new Date();
  return `${now.getFullYear()} Q${Math.floor(now.getMonth() / 3) + 1}`;
}

function krProgress(kr: KeyResult): number {
  // Guard against bad data: NaN/Infinity from `current` divided by `target`,
  // negative targets (the UI may allow them via free-form input), and
  // legitimate zero targets. Without these, a single corrupted KR (e.g.,
  // imported from JSON) used to NaN-propagate into the radar chart.
  if (!Number.isFinite(kr.target) || kr.target === 0) return 0;
  if (!Number.isFinite(kr.current)) return 0;
  const pct = kr.current / kr.target;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(1, pct));
}

function objectiveHealth(okr: Okr): number {
  if (okr.keyResults.length === 0) return 0;
  return okr.keyResults.reduce((a, kr) => a + krProgress(kr), 0) / okr.keyResults.length;
}

export function OkrsClient() {
  // BUG-T5-okrs-4: SINGLE source of truth. The prior dual-store design
  // (`usePersisted("agile-toolkit:okrs", ...)` + workspace.okrs with
  // Import/Push buttons to ferry data between) raced cross-tab edits
  // and silently overwrote workspace data on Push. The workspace store
  // is already persisted + cloud-synced; we read/write through it
  // directly, so there is no Workspace import/push button.
  const okrs = useWorkspaceStore((s) => s.okrs);
  const upsertOkr = useWorkspaceStore((s) => s.upsertOkr);
  const removeOkr = useWorkspaceStore((s) => s.removeOkr);
  const { log } = useHistoryLogger("okrs");

  // Smart-default predictor for the KR target field. Returns the mean
  // target across prior KRs (capped low/medium confidence) — anchors new
  // KRs against the team's historical sizing.
  const krTargetPrediction = usePredictedDefault<number>("okrs", "krTargetExtrapolation", 100);

  const add = () => {
    const obj = emptyOkr();
    upsertOkr(obj);
    log(OKR_ACTIONS.OBJECTIVE_ADDED, { okrId: obj.id });
  };
  const remove = (id: string) => {
    const obj = okrs.find((o) => o.id === id);
    removeOkr(id);
    log(OKR_ACTIONS.OBJECTIVE_REMOVED, { okrId: id, objective: obj?.objective });
  };
  const update = (id: string, patch: Partial<Okr>) => {
    const current = okrs.find((o) => o.id === id);
    if (!current) return;
    upsertOkr({ ...current, ...patch });
  };

  const addKr = (okrId: string) => {
    const current = okrs.find((o) => o.id === okrId);
    if (!current) return;
    const kr = emptyKr();
    upsertOkr({ ...current, keyResults: [...current.keyResults, kr] });
    log(OKR_ACTIONS.KEY_RESULT_ADDED, { okrId, krId: kr.id });
  };
  const updateKr = (okrId: string, krId: string, patch: Partial<KeyResult>) => {
    const current = okrs.find((o) => o.id === okrId);
    if (!current) return;
    upsertOkr({
      ...current,
      keyResults: current.keyResults.map((k) => (k.id === krId ? { ...k, ...patch } : k)),
    });
    if (patch.current !== undefined || patch.target !== undefined) {
      log(OKR_ACTIONS.PROGRESS_UPDATED, { okrId, krId, ...patch });
    }
  };
  const removeKr = (okrId: string, krId: string) => {
    const current = okrs.find((o) => o.id === okrId);
    if (!current) return;
    upsertOkr({
      ...current,
      keyResults: current.keyResults.filter((k) => k.id !== krId),
    });
    log(OKR_ACTIONS.KEY_RESULT_REMOVED, { okrId, krId });
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "OKR Tracker",
      prompts: generateOkrsPrompts({ okrs }),
    }),
    [okrs]
  );

  // Hoist per-OKR analytics into a single memo keyed on `okrs`. Previously
  // these chained five recomputations (Mann-Kendall, Bayesian Holt, CUSUM,
  // chart data, annotations) on every render *inside* the .map callback —
  // expensive on multi-OKR boards. The map below now just looks up the
  // pre-computed result by OKR id.
  type OkrAnalytics = {
    mk: ReturnType<typeof mannKendall> | null;
    fc: ReturnType<typeof forecastBayesianHolt>;
    fcConfidence: ReturnType<typeof bayesianForecastConfidence> | null;
    cps: ReturnType<typeof cusum>;
    krChartData: { kr: string; progressPct: number }[];
    krAnnotations: CausalAnnotationData[];
    measurableKrCount: number;
  };
  const analyticsByOkr = useMemo(() => {
    const map = new Map<string, OkrAnalytics>();
    for (const o of okrs) {
      // Filter out KRs with target<=0 — those are placeholder/invalid rows
      // that always evaluate to 0 progress and would bias both Mann-Kendall
      // and CUSUM toward "down" / spurious changepoints.
      const measurableKrs = o.keyResults.filter((kr) => kr.target > 0);
      const progressSeries = measurableKrs.map((kr) => krProgress(kr));
      const mk = progressSeries.length >= 5 ? mannKendall(progressSeries) : null;
      const fc =
        progressSeries.length >= 3
          ? forecastBayesianHolt(progressSeries, 1, { priorWeight: 1 })
          : [];
      const fcConfidence =
        progressSeries.length >= 3 ? bayesianForecastConfidence(progressSeries) : null;
      const cps = progressSeries.length >= 4 ? cusum(progressSeries) : [];
      const krChartData = measurableKrs.map((kr, idx) => ({
        kr: kr.title.slice(0, 24) || `KR${idx + 1}`,
        progressPct: Math.round(krProgress(kr) * 100),
      }));
      const krAnnotations: CausalAnnotationData[] = cps.map((cp) => ({
        x: krChartData[cp.index]?.kr ?? String(cp.index),
        label: `Progress regime ${cp.direction === "up" ? "↑" : "↓"}`,
        detail: `CUSUM detected a ${cp.direction === "up" ? "lift" : "drop"} in progress at this KR (across the KR sequence — not temporal).`,
        confidence: "weak" as const,
      }));
      map.set(o.id, {
        mk,
        fc,
        fcConfidence,
        cps,
        krChartData,
        krAnnotations,
        measurableKrCount: measurableKrs.length,
      });
    }
    return map;
  }, [okrs]);

  return (
    <ToolPageWrapper
      toolId="okrs"
      title="OKR Tracker"
      description="Track quarterly Objectives and Key Results with confidence scores and trajectory forecasts."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="okrs"
          csvData={{
            headers: [
              "Quarter",
              "Objective",
              "Objective Description",
              "KR",
              "KR Description",
              "Current",
              "Target",
              "Progress %",
              "Confidence",
            ],
            rows: okrs.flatMap((o) =>
              o.keyResults.map((kr) => [
                o.quarter,
                o.objective,
                o.description ?? "",
                kr.title,
                kr.description ?? "",
                kr.current,
                kr.target,
                Math.round(krProgress(kr) * 100),
                kr.confidence ?? "",
              ])
            ),
          }}
          jsonData={okrs}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Objective
        </Button>
      </ActionRow>

      <div className="space-y-4">
        {okrs.length === 0 && (
          <EmptyState icon={Flag}>
            No objectives yet. Click &ldquo;New Objective&rdquo; to start.
          </EmptyState>
        )}
        {okrs.map((o) => {
          const health = objectiveHealth(o);

          // Per-OKR analytics now hoisted into `analyticsByOkr` (single useMemo
          // keyed on `okrs`) — the previous inline computation re-ran 5
          // analytics primitives on every render. Lookup is O(1) and the
          // memo is invalidated only when the OKR list itself changes.
          const a = analyticsByOkr.get(o.id);
          const mk = a?.mk ?? null;
          const fc = a?.fc ?? [];
          const fcConfidence = a?.fcConfidence ?? null;
          const krChartData = a?.krChartData ?? [];
          const krAnnotations = a?.krAnnotations ?? [];
          const measurableKrCount = a?.measurableKrCount ?? 0;

          return (
            <Card key={o.id} className="bg-surface border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <Target className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2">
                      <BlurInput
                        value={o.objective}
                        onCommit={(v) => update(o.id, { objective: v })}
                        placeholder="Achieve X by end of quarter"
                        className="bg-bg border-border text-text"
                      />
                      <BlurInput
                        value={o.quarter}
                        onCommit={(v) => update(o.id, { quarter: v })}
                        placeholder="2026 Q2"
                        className="bg-bg border-border text-text font-data"
                      />
                    </div>
                    <BlurTextarea
                      value={o.description ?? ""}
                      onCommit={(v) =>
                        update(o.id, {
                          description: v.trim() ? v : undefined,
                        })
                      }
                      placeholder="Description (optional)..."
                      rows={2}
                      className="bg-bg border-border resize-none text-xs"
                      aria-label="Objective description"
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                      <Progress value={health * 100} className="h-2 flex-1 min-w-[120px]" />
                      <Badge variant="outline" className="font-data">
                        {Math.round(health * 100)}%
                      </Badge>
                      {/* BUG-T5-okrs-3: only surface the cross-KR
                          trend chip + Bayesian projection when there
                          are ≥10 KRs on the objective — below that,
                          the across-the-list signal is statistical
                          noise that invites real decision-making
                          errors. Adding one low-progress KR at the end
                          flipped "trend up" to "trend down" instantly
                          in the prior gate. */}
                      {mk && measurableKrCount >= 10 && (
                        <Badge
                          variant="outline"
                          className={`font-mono text-xs tracking-wider uppercase ${
                            !mk.significant || mk.trend === "none"
                              ? "text-sub border-border"
                              : mk.trend === "up"
                                ? "border-success/40 text-success bg-success/10"
                                : "border-warning/40 text-warning bg-warning/10"
                          }`}
                          title="Mann-Kendall trend across the KR list (NOT temporal). Shown only with ≥10 KRs."
                        >
                          {!mk.significant || mk.trend === "none"
                            ? "List flat"
                            : mk.trend === "up"
                              ? "List ↗"
                              : "List ↘"}
                        </Badge>
                      )}
                      {fc.length > 0 && fcConfidence && measurableKrCount >= 10 && (
                        <Badge
                          variant="outline"
                          className="font-mono text-xs tracking-wider uppercase text-accent border-accent/40 bg-accent/10"
                          title={`Across-the-list projection (NOT temporal). Confidence: ${fcConfidence}. Shown only with ≥10 KRs.`}
                        >
                          List proj ~ {Math.round(Math.max(0, Math.min(1, fc[0].yHat)) * 100)}%
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(o.id)}
                        className="text-sub hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {o.keyResults.map((kr) => {
                  // Only show the SmartInput chip on a KR whose target
                  // hasn't been edited yet (still at the default 100). Avoids
                  // chip clutter on already-set KRs.
                  const showTargetChip = kr.target === 100;
                  return (
                    <div
                      key={kr.id}
                      className="space-y-2 rounded-md border border-border bg-bg p-2"
                    >
                      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_80px_80px_80px_32px] gap-2 items-center">
                        <BlurInput
                          value={kr.title}
                          onCommit={(v) => updateKr(o.id, kr.id, { title: v })}
                          placeholder="KR: Increase DAU from 1k to 10k"
                          className="bg-surface border-border col-span-2 sm:col-span-1"
                        />
                        <div className="flex flex-wrap gap-2 col-span-2 sm:contents">
                          <NumCell
                            value={kr.current}
                            onChange={(n) => updateKr(o.id, kr.id, { current: n })}
                            placeholder="Current"
                            className="bg-surface border-border font-data flex-1 min-w-[80px] sm:flex-none sm:min-w-0"
                          />
                          {showTargetChip ? (
                            <SmartInput<number>
                              predicted={krTargetPrediction}
                              onAccept={(v) => updateKr(o.id, kr.id, { target: v })}
                              render={({ chip }) => (
                                <div className="flex flex-col gap-0 flex-1 min-w-[80px] sm:flex-none sm:min-w-0">
                                  <NumCell
                                    value={kr.target}
                                    onChange={(n) => updateKr(o.id, kr.id, { target: n })}
                                    placeholder="Target"
                                    className="bg-surface border-border font-data"
                                  />
                                  {chip}
                                </div>
                              )}
                            />
                          ) : (
                            <NumCell
                              value={kr.target}
                              onChange={(n) => updateKr(o.id, kr.id, { target: n })}
                              placeholder="Target"
                              className="bg-surface border-border font-data flex-1 min-w-[80px] sm:flex-none sm:min-w-0"
                            />
                          )}
                          <NumCell
                            value={kr.confidence ?? 5}
                            onChange={(n) => updateKr(o.id, kr.id, { confidence: n })}
                            min={0}
                            max={10}
                            title="Confidence (0-10)"
                            className="bg-surface border-border font-data flex-1 min-w-[80px] sm:flex-none sm:min-w-0"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeKr(o.id, kr.id)}
                            className="text-sub hover:text-danger shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <BlurTextarea
                        value={kr.description ?? ""}
                        onCommit={(v) =>
                          updateKr(o.id, kr.id, {
                            description: v.trim() ? v : undefined,
                          })
                        }
                        placeholder="Description (optional)..."
                        rows={2}
                        className="bg-surface border-border resize-none text-xs"
                        aria-label="Key result description"
                      />
                    </div>
                  );
                })}
                {/* KR-progress mini-chart with CUSUM regime markers, only
                    when there are enough *measurable* KRs (target>0, n>=4)
                    for the analysis to mean anything — placeholder rows
                    with target=0 are excluded from the analytics series. */}
                {measurableKrCount >= 4 && (
                  <ChartCard title="KR progress (across KR sequence)" height={180} className="mt-2">
                    <LineChart
                      data={krChartData}
                      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                    >
                      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="kr"
                        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
                        interval={0}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
                      />
                      <Tooltip contentStyle={chartTheme.tooltipStyle} />
                      <Line
                        type="monotone"
                        dataKey="progressPct"
                        name="Progress %"
                        stroke={chartTheme.colors.cyan}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <ReferenceLine
                        y={70}
                        stroke={chartTheme.colors.amber}
                        strokeDasharray="2 4"
                        strokeOpacity={0.55}
                        label={{
                          value: "Target band",
                          fill: chartTheme.colors.amber,
                          fontSize: 10,
                          position: "right",
                        }}
                      />
                      {krAnnotations.map((ann, i) => (
                        <CausalLine key={`okr-cusum-${i}`} annotation={ann} />
                      ))}
                    </LineChart>
                  </ChartCard>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addKr(o.id)}
                  className="gap-2 border-border text-sub hover:text-accent hover:border-accent/30"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Key Result
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
