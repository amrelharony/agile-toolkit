"use client";

import { useEffect, useMemo } from "react";
import { nanoid } from "nanoid";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { WorkspaceSyncButton } from "@/components/shared/workspace-sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ShieldAlert, TrendingUp } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import { cusum } from "@/lib/analytics/changepoint";
import { generateRiskRegisterPrompts } from "@/lib/ai-prompts/risk-register";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RISK_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SmartInput } from "@/components/shared/smart-input";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { chartTheme } from "@/components/charts/chart-theme";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import type { PredictedValue } from "@/lib/predictions/registry";
import { emit as sonify } from "@/lib/sonification/emit";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";

function emptyRisk(): Risk {
  return {
    id: nanoid(8),
    title: "",
    probability: 3,
    impact: 3,
    status: "open",
    raisedAt: todayLocalISO(),
  };
}

function riskScore(r: Risk): number {
  return r.probability * r.impact;
}

function riskColor(score: number): string {
  if (score >= 16) return "#ef4444";
  if (score >= 10) return "#f59e0b";
  if (score >= 5) return "#facc15";
  return "#34d399";
}

/** Parse an ISO yyyy-mm-dd date string into a UTC-anchored Date. */
function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Format a Date as yyyy-mm-dd in UTC. */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add N days to a yyyy-mm-dd ISO date string (UTC). */
function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso) ?? new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

/**
 * Bucket a series of risk timestamps into weekly counts and open-counts.
 * Buckets are ISO weeks anchored on the Monday of the earliest event;
 * we cap the series at 26 weeks so short histories don't disappear behind
 * a long tail of empty weeks and forecast quality stays useful.
 */
function buildWeeklyRiskSeries(risks: Risk[]): {
  raisedPerWeek: number[];
  openAtWeek: number[];
  weekLabels: string[];
} {
  if (risks.length === 0) return { raisedPerWeek: [], openAtWeek: [], weekLabels: [] };
  const raisedDates = risks.map((r) => parseISODate(r.raisedAt)).filter((d): d is Date => d !== null);
  if (raisedDates.length === 0) return { raisedPerWeek: [], openAtWeek: [], weekLabels: [] };

  const earliest = new Date(Math.min(...raisedDates.map((d) => d.getTime())));
  // Anchor on the Sunday of the earliest week (UTC).
  const dayOfWeek = earliest.getUTCDay();
  const weekStart = new Date(earliest);
  weekStart.setUTCDate(earliest.getUTCDate() - dayOfWeek);
  weekStart.setUTCHours(0, 0, 0, 0);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totalWeeks = Math.max(
    1,
    Math.ceil((today.getTime() - weekStart.getTime()) / (7 * 86_400_000)) + 1,
  );
  const cappedWeeks = Math.min(totalWeeks, 26);

  const raisedPerWeek = new Array(cappedWeeks).fill(0) as number[];
  const openAtWeek = new Array(cappedWeeks).fill(0) as number[];
  const weekLabels: string[] = [];

  // Pre-parse each risk's dates once — previously `parseISODate` was called
  // per (risk × week), which is O(N·W) parses. For N=200 risks across W=26
  // weeks that's 5200 parses per render; the cache drops it to N.
  const parsedRisks = risks
    .map((r) => {
      const raised = parseISODate(r.raisedAt);
      if (!raised) return null;
      return {
        raisedT: raised.getTime(),
        resolvedT: r.resolvedAt ? parseISODate(r.resolvedAt)?.getTime() ?? null : null,
      };
    })
    .filter((x): x is { raisedT: number; resolvedT: number | null } => x !== null);

  for (let w = 0; w < cappedWeeks; w++) {
    const weekStartT = weekStart.getTime() + w * 7 * 86_400_000;
    const weekEndT = weekStartT + 7 * 86_400_000;
    weekLabels.push(toISODate(new Date(weekStartT)));

    let raised = 0;
    let open = 0;
    for (const r of parsedRisks) {
      if (r.raisedT >= weekStartT && r.raisedT < weekEndT) raised++;
      // Open as of the END of the week: raised on/before week-end and not yet resolved by week-end.
      if (r.raisedT < weekEndT) {
        if (r.resolvedT === null || r.resolvedT >= weekEndT) open++;
      }
    }
    raisedPerWeek[w] = raised;
    openAtWeek[w] = open;
  }

  return { raisedPerWeek, openAtWeek, weekLabels };
}

export function RiskRegisterClient() {
  const [risks, setRisks] = usePersisted<Risk[]>("agile-toolkit:risk-register", []);
  const workspaceRisks = useWorkspaceStore((s) => s.risks);
  const upsertWorkspaceRisk = useWorkspaceStore((s) => s.upsertRisk);
  const { log } = useHistoryLogger("risk-register");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const add = () => {
    sonify("risk-register", "risk-added");
    const risk = emptyRisk();
    setRisks((r) => [risk, ...r]);
    log(RISK_ACTIONS.RISK_ADDED, { riskId: risk.id });
  };
  const update = (id: string, patch: Partial<Risk>) => {
    setRisks((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    log(RISK_ACTIONS.RISK_UPDATED, { riskId: id, fields: Object.keys(patch) });
  };
  const remove = (id: string) => {
    const risk = risks.find((x) => x.id === id);
    setRisks((r) => r.filter((x) => x.id !== id));
    log(RISK_ACTIONS.RISK_REMOVED, { riskId: id, title: risk?.title });
  };

  const matrix = useMemo(() => {
    const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
    for (const r of risks.filter((x) => x.status !== "closed")) {
      grid[r.probability - 1][r.impact - 1]++;
    }
    return grid;
  }, [risks]);

  const survivalCurve = useMemo(() => {
    const obs = durationsFromTimeRanges(risks.map((r) => ({ raisedAt: r.raisedAt, resolvedAt: r.resolvedAt })));
    return kaplanMeier(obs);
  }, [risks]);

  const medianTTM = medianSurvivalTime(survivalCurve);

  // ── Phase-15 analytics: weekly trend, forecast, changepoints ─────────
  const { raisedPerWeek, openAtWeek, weekLabels } = useMemo(
    () => buildWeeklyRiskSeries(risks),
    [risks],
  );

  // Mann-Kendall on the raised-per-week series (need n>=5 for meaningful trend).
  const raisedTrend = useMemo(() => {
    if (raisedPerWeek.length < 5) return null;
    return mannKendall(raisedPerWeek);
  }, [raisedPerWeek]);

  // Bayesian forecast on the open-risks series — 4-week horizon.
  const openForecast = useMemo(() => {
    if (openAtWeek.length < 3) return [];
    return forecastBayesianHolt(openAtWeek, 4, { priorWeight: 2 });
  }, [openAtWeek]);

  // CUSUM on the open-risks series — flag regime shifts.
  const openChangepoints = useMemo(() => {
    if (openAtWeek.length < 4) return [];
    return cusum(openAtWeek);
  }, [openAtWeek]);

  // Annotations rendered as <CausalLine> inside the forecast chart.
  const causalAnnotations = useMemo<CausalAnnotationData[]>(
    () =>
      openChangepoints.map((cp) => ({
        x: weekLabels[cp.index] ?? cp.index,
        label: cp.direction === "up" ? "Open-risk surge" : "Open-risk drop",
        detail: `CUSUM detected a ${cp.direction === "up" ? "rise" : "fall"} regime shift in open-risk count at week ${weekLabels[cp.index] ?? cp.index} (cumulative stat ${cp.cumulativeStat.toFixed(2)}σ).`,
        confidence: Math.abs(cp.cumulativeStat) > 6 ? "strong" : "moderate",
      })),
    [openChangepoints, weekLabels],
  );

  // Build the chart data: historical actuals + forecast band.
  const forecastChartData = useMemo(() => {
    const data: Array<{
      x: string;
      actual?: number;
      yHat?: number;
      band80Lower?: number;
      band80Upper?: number;
    }> = weekLabels.map((label, i) => ({ x: label, actual: openAtWeek[i] }));
    // Bridge actual → forecast at the boundary so the forecast line is connected.
    if (data.length > 0 && openForecast.length > 0) {
      const last = data[data.length - 1];
      data[data.length - 1] = {
        ...last,
        yHat: last.actual,
        band80Lower: last.actual,
        band80Upper: last.actual,
      };
      const lastDate = parseISODate(weekLabels[weekLabels.length - 1]) ?? new Date();
      openForecast.forEach((f, i) => {
        const next = new Date(lastDate.getTime() + (i + 1) * 7 * 86_400_000);
        data.push({
          x: toISODate(next),
          yHat: f.yHat,
          band80Lower: Math.max(0, f.lower80),
          band80Upper: f.upper80,
        });
      });
    }
    return data;
  }, [weekLabels, openAtWeek, openForecast]);

  // Smart-default predictor for mitigation lead-time (in days).
  const mitigationDaysPrediction = usePredictedDefault<number>(
    "risk-register",
    "mitigationDays",
    14,
  );

  // Pre-compute per-risk SmartInput.predicted objects keyed by risk id so the
  // inline `{ value: addDaysISO(...) }` is not recreated on every render —
  // SmartInput compares predicted by identity to decide whether to refresh
  // the ghost. The map only changes when the prediction outputs or any
  // risk's raisedAt changes. Type matches SmartInputProps<string>['predicted'].
  const predictedMitigationByRisk = useMemo(() => {
    type PredictedDate =
      | PredictedValue<string>
      | { value: string; confidence: "none" };
    const m = new Map<string, PredictedDate>();
    for (const r of risks) {
      if (mitigationDaysPrediction.confidence === "none") {
        m.set(r.id, { value: "", confidence: "none" });
      } else {
        m.set(r.id, {
          value: addDaysISO(r.raisedAt, mitigationDaysPrediction.value),
          confidence: mitigationDaysPrediction.confidence,
          source:
            mitigationDaysPrediction.source ??
            `${mitigationDaysPrediction.value}-day median lead time`,
        });
      }
    }
    return m;
  }, [
    risks,
    mitigationDaysPrediction.value,
    mitigationDaysPrediction.confidence,
    mitigationDaysPrediction.source,
  ]);

  const handleImport = () => {
    const fresh = workspaceRisks.filter((w) => !risks.find((r) => r.id === w.id));
    setRisks((r) => [...fresh, ...r]);
    return fresh.length;
  };
  const handlePush = () => {
    let n = 0;
    for (const r of risks) {
      if (r.title.trim()) {
        upsertWorkspaceRisk(r);
        n++;
      }
    }
    return n;
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "Risk Register",
      prompts: generateRiskRegisterPrompts({ risks, medianTTM }),
    }),
    [risks, medianTTM]
  );

  return (
    <ToolPageWrapper
      toolId="risk-register"
      title="Risk Register"
      description="Track risks on a 5×5 probability × impact matrix with mitigation plans and time-to-mitigate survival analysis."
      category="Risk & Governance"
    >
      <ActionRow>
        <WorkspaceSyncButton toolName="Risk Register" onImport={handleImport} onPush={handlePush} />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="risk-register"
          csvData={{
            headers: ["Title", "Probability", "Impact", "Score", "Status", "Mitigation", "Mitigation Due", "Raised", "Resolved"],
            rows: risks.map((r) => [
              r.title,
              r.probability,
              r.impact,
              riskScore(r),
              r.status,
              r.mitigation ?? "",
              r.mitigationDueAt ?? "",
              r.raisedAt,
              r.resolvedAt ?? "",
            ]),
          }}
          jsonData={risks}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Risk
        </Button>
      </ActionRow>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6 mb-6">
        <Card className="bg-surface border-border">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-accent" />
              5×5 Matrix
            </div>
            <div className="grid grid-cols-6 gap-1 text-[10px]">
              <div />
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={`h${i}`} className="text-center text-sub font-data">
                  I{i}
                </div>
              ))}
              {[5, 4, 3, 2, 1].map((prob) => (
                <div key={`row${prob}`} style={{ display: "contents" }}>
                  <div className="text-sub font-data text-right pr-1">P{prob}</div>
                  {[1, 2, 3, 4, 5].map((imp) => {
                    const count = matrix[prob - 1][imp - 1];
                    const score = prob * imp;
                    return (
                      <div
                        key={`${prob}-${imp}`}
                        className="h-8 rounded flex items-center justify-center font-data text-xs"
                        style={{ background: `${riskColor(score)}33`, color: riskColor(score), border: `1px solid ${riskColor(score)}66` }}
                      >
                        {count || ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <KpiGrid cols={4} marginBottom="none">
          <StatCard
            variant="compact"
            label="Open"
            value={risks.filter((r) => r.status === "open").length}
            valueClassName="text-accent"
          />
          <StatCard
            variant="compact"
            label="Mitigating"
            value={risks.filter((r) => r.status === "mitigating").length}
          />
          <StatCard
            variant="compact"
            label="Closed"
            value={risks.filter((r) => r.status === "closed").length}
          />
          <StatCard
            variant="compact"
            label="Median TTM"
            value={medianTTM !== null ? `${medianTTM}d` : "—"}
          />
        </KpiGrid>
      </div>

      {/* Trend chip — Mann-Kendall over weekly raised count. */}
      {raisedTrend && (
        <div className="mb-4">
          {raisedTrend.significant ? (
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border ${
                raisedTrend.trend === "up"
                  ? "border-[#ef4444]/40 text-[#ef4444] bg-[#ef4444]/10"
                  : "border-[#34d399]/40 text-[#34d399] bg-[#34d399]/10"
              }`}
            >
              <TrendingUp className={`w-3 h-3 ${raisedTrend.trend === "down" ? "rotate-180" : ""}`} />
              Risk creation trending {raisedTrend.trend} significantly
              <span className="opacity-60">· p={raisedTrend.pValue.toFixed(3)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-border text-sub bg-[var(--surface-hover)]">
              <TrendingUp className="w-3 h-3" />
              Risk creation trend: no significant change
            </span>
          )}
        </div>
      )}

      {/* Open-risks forecast with CUSUM markers — only when we have enough history. */}
      {openAtWeek.length >= 3 && (
        <div className="mb-6">
          <SectionCard title="Open Risks Over Time" icon={TrendingUp}>
            <div className="h-64 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={forecastChartData}
                  margin={{ top: 12, right: 24, bottom: 24, left: 12 }}
                >
                  <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                  <XAxis dataKey="x" stroke={chartTheme.axisColor} fontSize={11} />
                  <YAxis stroke={chartTheme.axisColor} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={chartTheme.tooltipStyle} />
                  <Legend wrapperStyle={chartTheme.legendStyle} />
                  <Area
                    dataKey="band80Upper"
                    stroke="none"
                    fill={chartTheme.colors.cyan}
                    fillOpacity={0.18}
                    name="80% band"
                    connectNulls
                  />
                  <Area
                    dataKey="band80Lower"
                    stroke="none"
                    fill={chartTheme.background}
                    fillOpacity={1}
                    legendType="none"
                    connectNulls
                  />
                  <Line
                    dataKey="actual"
                    stroke={chartTheme.colors.cyan}
                    strokeWidth={2}
                    dot={{ fill: chartTheme.colors.cyan, r: 3 }}
                    name="Open risks"
                    connectNulls={false}
                  />
                  <Line
                    dataKey="yHat"
                    stroke={chartTheme.colors.cyan}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Forecast"
                    connectNulls
                  />
                  {causalAnnotations.map((ann, i) => (
                    <CausalLine key={`cp-${i}`} annotation={ann} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {causalAnnotations.length > 0 && (
              <div className="mt-2 text-[11px] text-sub">
                {causalAnnotations.length} regime shift{causalAnnotations.length !== 1 ? "s" : ""} detected (CUSUM markers)
              </div>
            )}
          </SectionCard>
        </div>
      )}

      <div className="space-y-2">
        {risks
          .slice()
          .sort((a, b) => riskScore(b) - riskScore(a))
          .map((r) => {
            const score = riskScore(r);
            return (
              <Card key={r.id} className="bg-surface border-border">
                <CardContent className="p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_80px_80px_140px_auto] gap-2">
                    <div className="space-y-0.5">
                      <Input
                        value={r.title}
                        onChange={(e) => update(r.id, { title: e.target.value })}
                        placeholder="Risk title"
                        className="bg-bg border-border"
                      />
                      {/* Mitigation preview under the title — mirrors the
                          kanban description style so the gist is visible at a
                          glance before the user reaches the editable textarea
                          below. */}
                      {r.mitigation && r.mitigation.trim().length > 0 && (
                        <div className="text-sub text-[11px] mt-0.5 mb-1.5 whitespace-pre-wrap break-words">
                          {r.mitigation}
                        </div>
                      )}
                    </div>
                    <Select value={String(r.probability)} onValueChange={(v) => update(r.id, { probability: Number(v) as Risk["probability"] })}>
                      <SelectTrigger className="bg-bg border-border font-data">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((i) => <SelectItem key={i} value={String(i)}>P{i}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(r.impact)} onValueChange={(v) => update(r.id, { impact: Number(v) as Risk["impact"] })}>
                      <SelectTrigger className="bg-bg border-border font-data">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((i) => <SelectItem key={i} value={String(i)}>I{i}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.status} onValueChange={(v) => update(r.id, { status: v as Risk["status"], resolvedAt: v === "closed" ? todayLocalISO() : undefined })}>
                      <SelectTrigger className="bg-bg border-border capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="mitigating">Mitigating</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded-md font-data text-sm" style={{ background: `${riskColor(score)}22`, color: riskColor(score), border: `1px solid ${riskColor(score)}66` }}>
                        {score}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => remove(r.id)} className="text-sub hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    rows={2}
                    value={r.mitigation ?? ""}
                    onChange={(e) => update(r.id, { mitigation: e.target.value })}
                    placeholder="Mitigation plan..."
                    className="bg-bg border-border text-sm"
                  />
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-sub font-mono shrink-0 w-32">
                        Mitigation due
                      </span>
                      <SmartInput<string>
                        predicted={
                          predictedMitigationByRisk.get(r.id) ?? {
                            value: "",
                            confidence: "none",
                          }
                        }
                        onAccept={(value) => update(r.id, { mitigationDueAt: value })}
                        render={({ ghost, accept, chip }) => (
                          <div className="flex flex-col gap-1 flex-1">
                            <Input
                              type="date"
                              value={r.mitigationDueAt ?? ""}
                              onChange={(e) => update(r.id, { mitigationDueAt: e.target.value || undefined })}
                              onKeyDown={(e) => {
                                if (e.key === "Tab" && !r.mitigationDueAt && ghost) {
                                  e.preventDefault();
                                  accept();
                                }
                              }}
                              placeholder={ghost}
                              className="bg-bg border-border text-sm font-data h-8"
                            />
                            {!r.mitigationDueAt && chip}
                          </div>
                        )}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        {risks.length === 0 && (
          <EmptyState icon={ShieldAlert}>
            No risks logged. Click &ldquo;New Risk&rdquo; to start.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
