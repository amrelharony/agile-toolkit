"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { SmartInput } from "@/components/shared/smart-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/utils/toast";
import { Plus, Trash2, Rocket, Clock, AlertTriangle, Wrench } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { generateDoraPrompts } from "@/lib/ai-prompts/dora-scorecard";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DoraSample } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DORA_ACTIONS } from "@/lib/history/event-actions";

type Band = "Elite" | "High" | "Medium" | "Low";

interface DoraState {
  samples: DoraSample[];
}

const DEFAULT_STATE: DoraState = { samples: [] };

const DS_ID = "doraScorecard:current"; // MUST match DS_ID in dora-scorecard.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// sample writes round-trip into the UI. Drop-in [state, setState].
function useDoraScorecard(): [DoraState, (u: DoraState | ((p: DoraState) => DoraState)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.doraScorecards ?? []).find((d) => d.id === DS_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertDoraScorecard);
  const state: DoraState = doc ? { samples: doc.samples } : DEFAULT_STATE;
  const setState = (u: DoraState | ((p: DoraState) => DoraState)) => {
    const cur = (useWorkspaceStore.getState().doraScorecards ?? []).find((d) => d.id === DS_ID);
    const curState: DoraState = cur ? { samples: cur.samples } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: DS_ID, samples: next.samples });
  };
  return [state, setState];
}

const BAND_TONE: Record<Band, "success" | "default" | "warning" | "danger"> = {
  Elite: "success",
  High: "default",
  Medium: "warning",
  Low: "danger",
};

/* ── Banding helpers ────────────────────────────────────────────────────── */
// Per Accelerate / DORA 2023 report. Upper bounds are inclusive (`<=`) so
// boundary values (e.g. exactly 24h lead time) fall into the better band.
// Negative/NaN inputs default to the Low band (the safe pessimistic choice).
function bandDeploy(perWeek: number): Band {
  if (!Number.isFinite(perWeek) || perWeek < 0) return "Low";
  // Elite: multiple deploys per day (~≥14/wk = 2/weekday). High: weekly to daily.
  // Medium: monthly (~0.25/wk) to weekly. Low: less than monthly.
  if (perWeek >= 14) return "Elite";
  if (perWeek >= 1) return "High";
  if (perWeek >= 0.25) return "Medium";
  return "Low";
}
function bandLead(hours: number): Band {
  if (!Number.isFinite(hours) || hours < 0) return "Low";
  // Elite: less than one day. High: one day to one week. Medium: one week to
  // one month. Low: more than one month.
  if (hours <= 24) return "Elite";
  if (hours <= 24 * 7) return "High";
  if (hours <= 24 * 30) return "Medium";
  return "Low";
}
function bandCfr(rate: number): Band {
  if (!Number.isFinite(rate) || rate < 0) return "Low";
  if (rate <= 0.15) return "Elite";
  if (rate <= 0.3) return "High";
  if (rate <= 0.45) return "Medium";
  return "Low";
}
function bandMttr(hours: number): Band {
  if (!Number.isFinite(hours) || hours < 0) return "Low";
  // Elite: less than one hour. High: less than one day. Medium: less than
  // one week. Low: more than one week (per DORA 2023).
  if (hours <= 1) return "Elite";
  if (hours <= 24) return "High";
  if (hours <= 24 * 7) return "Medium";
  return "Low";
}

/* ── Default-quarter helper (e.g. "2026-Q2") ────────────────────────────── */
function defaultQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

interface DraftState {
  quarter: string;
  deployFreqPerWeek: string;
  leadTimeHours: string;
  changeFailRatePct: string; // user enters % (0-100); we store 0-1
  mttrHours: string;
  description: string;
}

function makeDraft(): DraftState {
  return {
    quarter: defaultQuarter(),
    deployFreqPerWeek: "",
    leadTimeHours: "",
    changeFailRatePct: "",
    mttrHours: "",
    description: "",
  };
}

export function DoraScorecardClient() {
  const [state, setState] = useDoraScorecard();
  const [draft, setDraft] = useState<DraftState>(makeDraft);
  const { log } = useHistoryLogger("dora-scorecard");

  // Numeric draft commits — clamp on blur, never mid-edit. We store the raw
  // string in `draft` and resolve to a number only inside `addSample`.
  // BUG-T2-dora-scorecard-2: reject empty strings explicitly so a blank
  // field doesn't parse to 0 (which would silently band as Elite for
  // CFR / MTTR / lead-time and Low for deploy-freq, producing a
  // "phantom Elite" sample that misrepresents missing data as best-
  // in-class data).
  const parsePositive = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const parsePercent = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, n / 100));
  };

  const addSample = () => {
    const deploy = parsePositive(draft.deployFreqPerWeek);
    const lead = parsePositive(draft.leadTimeHours);
    const cfr = parsePercent(draft.changeFailRatePct);
    const mttr = parsePositive(draft.mttrHours);
    if (deploy === null || lead === null || cfr === null || mttr === null) {
      toast.error("All metric fields must be valid non-negative numbers.");
      return;
    }
    const quarterTrimmed = draft.quarter.trim();
    if (!quarterTrimmed) {
      toast.error("Quarter is required.");
      return;
    }
    // R5: enforce YYYY-Q[1-4] so localeCompare sorts chronologically.
    // Free-text like "Q1 2026" or "2026-Q10" sorted wrong + duplicates
    // broke the chart x-axis (Recharts treats dup keys as one point).
    // BUG-RD3-dora-scorecard-1: surface the rejection. The prior
    // silent `return` made the Add button do nothing visible, and
    // users had no idea their typed "Q1 2026" / "2026-Q10" was being
    // rejected by the format check.
    if (!/^\d{4}-Q[1-4]$/.test(quarterTrimmed)) {
      toast.error(`Quarter must be YYYY-Q[1-4] (e.g. 2026-Q2). Got "${quarterTrimmed}".`);
      return;
    }
    if (state.samples.some((s) => s.quarter === quarterTrimmed)) {
      toast.error(`A sample for ${quarterTrimmed} already exists. Remove it first to re-add.`);
      return;
    }
    const sample: DoraSample = {
      id: crypto.randomUUID(),
      quarter: quarterTrimmed,
      deployFreqPerWeek: deploy,
      leadTimeHours: lead,
      changeFailRate: cfr,
      mttrHours: mttr,
      description: draft.description.trim() || undefined,
    };
    setState((s) => ({ samples: [...s.samples, sample] }));
    log(DORA_ACTIONS.SAMPLE_LOGGED, {
      sampleId: sample.id,
      quarter: sample.quarter,
      deployFreqPerWeek: sample.deployFreqPerWeek,
      leadTimeHours: sample.leadTimeHours,
      changeFailRate: sample.changeFailRate,
      mttrHours: sample.mttrHours,
      description: sample.description,
    });
    setDraft(makeDraft());
  };

  const removeSample = (id: string) => {
    const sample = state.samples.find((s) => s.id === id);
    setState((s) => ({ samples: s.samples.filter((x) => x.id !== id) }));
    log(DORA_ACTIONS.SAMPLE_REMOVED, {
      sampleId: id,
      quarter: sample?.quarter,
      description: sample?.description,
    });
  };

  // Sort samples chronologically by quarter string for the chart.
  const sorted = useMemo(
    () => [...state.samples].sort((a, b) => a.quarter.localeCompare(b.quarter)),
    [state.samples]
  );
  const latest = sorted[sorted.length - 1];

  const chartData = useMemo(
    () =>
      sorted.map((s) => ({
        quarter: s.quarter,
        deployFreqPerWeek: Number(s.deployFreqPerWeek.toFixed(2)),
        leadTimeHours: Number(s.leadTimeHours.toFixed(1)),
        changeFailRatePct: Number((s.changeFailRate * 100).toFixed(1)),
        mttrHours: Number(s.mttrHours.toFixed(1)),
      })),
    [sorted]
  );

  // ── XmR control limits on deploy frequency (most actionable DORA SPC) ──
  // Anchors UCL / CenterLine / LCL on the trend chart so out-of-control
  // quarters are visible at a glance. Returns null when n < 4 — limits are
  // unstable on tiny series.
  const deployControl = useMemo(() => {
    const series = sorted.map((s) => s.deployFreqPerWeek);
    if (series.length < 4) return null;
    // Deploys-per-week is a non-negative count; clamp LCL at 0.
    return xmrLimits(series, true);
  }, [sorted]);

  // ── CUSUM markers on the deploy-frequency series ────────────────────────
  // Each detected changepoint becomes a CausalLine on the chart so DORA
  // banding regime shifts ("we crossed into Elite at Q3") are obvious.
  // Filtered to only changepoints whose quarter is on the chart's x-axis
  // — `ifOverflow="extendDomain"` would otherwise distort the chart with
  // phantom ticks for off-domain markers.
  const deployChangepoints = useMemo<CausalAnnotationData[]>(() => {
    const series = sorted.map((s) => s.deployFreqPerWeek);
    if (series.length < 4) return [];
    const xValuesInChart = new Set(sorted.map((s) => s.quarter));
    return cusum(series)
      .map((cp): CausalAnnotationData | null => {
        const sample = sorted[cp.index];
        if (!sample) return null;
        return {
          x: sample.quarter,
          label: `Deploy regime ${cp.direction === "up" ? "↑" : "↓"}`,
          detail: `CUSUM detected a ${cp.direction === "up" ? "lift" : "drop"} in deploy frequency at ${sample.quarter}.`,
          // Reflect the magnitude of the cumulative statistic — strong signals
          // should read differently than borderline ones (matches cycle-time/CFD).
          // CUSUM is signed: downward regime shifts produce negative values
          // that the prior `>= 6` test always classified "moderate". abs()
          // restores the symmetric intent.
          confidence: Math.abs(cp.cumulativeStat) >= 6 ? "strong" : "moderate",
        };
      })
      .filter((a): a is CausalAnnotationData => a !== null && xValuesInChart.has(a.x as string));
  }, [sorted]);

  // ── Mann-Kendall trend chips for each of the four DORA metrics ─────────
  // Renders muted when the test is non-significant or sample is too small.
  const trends = useMemo(() => {
    if (sorted.length < 5) return null;
    return {
      deploy: mannKendall(sorted.map((s) => s.deployFreqPerWeek)),
      lead: mannKendall(sorted.map((s) => s.leadTimeHours)),
      cfr: mannKendall(sorted.map((s) => s.changeFailRate)),
      mttr: mannKendall(sorted.map((s) => s.mttrHours)),
    };
  }, [sorted]);

  // ── Smart-default predictor for the deploy-frequency input ─────────────
  const deployPrediction = usePredictedDefault<number>("dora-scorecard", "deploysPerWeekTarget", 0);

  const promptConfig = useMemo(
    () => ({
      toolName: "DORA Scorecard",
      prompts: generateDoraPrompts({ samples: sorted }),
    }),
    [sorted]
  );

  return (
    <ToolPageWrapper
      toolId="dora-scorecard"
      title="DORA Scorecard"
      description="Quarterly DORA samples (deploy frequency, lead time, change-failure rate, MTTR) with Elite/High/Medium/Low banding and trend."
      category="Engineering Excellence"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="dora-scorecard"
          csvData={{
            headers: [
              "Quarter",
              "Deploy/wk",
              "Lead (h)",
              "Change Fail Rate",
              "MTTR (h)",
              "Description",
            ],
            rows: sorted.map((s) => [
              s.quarter,
              s.deployFreqPerWeek,
              s.leadTimeHours,
              s.changeFailRate,
              s.mttrHours,
              s.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      {latest ? (
        <>
          <KpiGrid cols={4} gap="lg">
            <StatCard
              variant="compact"
              icon={Rocket}
              label="Deploy/wk"
              value={latest.deployFreqPerWeek.toFixed(2)}
              hint={bandDeploy(latest.deployFreqPerWeek)}
              tone={BAND_TONE[bandDeploy(latest.deployFreqPerWeek)]}
            />
            <StatCard
              variant="compact"
              icon={Clock}
              label="Lead time"
              value={`${latest.leadTimeHours.toFixed(1)}h`}
              hint={bandLead(latest.leadTimeHours)}
              tone={BAND_TONE[bandLead(latest.leadTimeHours)]}
            />
            <StatCard
              variant="compact"
              icon={AlertTriangle}
              label="Change-fail rate"
              value={`${(latest.changeFailRate * 100).toFixed(1)}%`}
              hint={bandCfr(latest.changeFailRate)}
              tone={BAND_TONE[bandCfr(latest.changeFailRate)]}
            />
            <StatCard
              variant="compact"
              icon={Wrench}
              label="MTTR"
              value={`${latest.mttrHours.toFixed(1)}h`}
              hint={bandMttr(latest.mttrHours)}
              tone={BAND_TONE[bandMttr(latest.mttrHours)]}
            />
          </KpiGrid>
          {trends && (
            <div className="flex flex-wrap gap-2 -mt-2 mb-2" aria-label="DORA metric trends">
              <TrendChip
                label="Deploy/wk"
                trend={trends.deploy.trend}
                significant={trends.deploy.significant}
              />
              <TrendChip
                label="Lead time"
                trend={trends.lead.trend}
                significant={trends.lead.significant}
                betterDown
              />
              <TrendChip
                label="CFR"
                trend={trends.cfr.trend}
                significant={trends.cfr.significant}
                betterDown
              />
              <TrendChip
                label="MTTR"
                trend={trends.mttr.trend}
                significant={trends.mttr.significant}
                betterDown
              />
            </div>
          )}
        </>
      ) : (
        <KpiGrid cols={4} gap="lg">
          <StatCard variant="compact" label="Deploy/wk" value="—" hint="No data" />
          <StatCard variant="compact" label="Lead time" value="—" hint="No data" />
          <StatCard variant="compact" label="Change-fail rate" value="—" hint="No data" />
          <StatCard variant="compact" label="MTTR" value="—" hint="No data" />
        </KpiGrid>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Log a quarterly sample" icon={Plus} titleSize="lg">
          <div className="space-y-3">
            <div>
              <Label htmlFor="dora-quarter" className="text-xs text-sub">
                Quarter
              </Label>
              <Input
                id="dora-quarter"
                value={draft.quarter}
                onChange={(e) => setDraft((d) => ({ ...d, quarter: e.target.value }))}
                placeholder="2026-Q1"
                className="bg-surface border-border"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SmartInput<number>
                predicted={deployPrediction}
                onAccept={(v) => setDraft((d) => ({ ...d, deployFreqPerWeek: String(v) }))}
                render={({ chip }) => (
                  <div>
                    <NumericField
                      id="dora-deploy"
                      label="Deploys / week"
                      value={draft.deployFreqPerWeek}
                      onChange={(v) => setDraft((d) => ({ ...d, deployFreqPerWeek: v }))}
                      placeholder="e.g. 12"
                    />
                    {chip}
                  </div>
                )}
              />
              <NumericField
                id="dora-lead"
                label="Lead time (hours)"
                value={draft.leadTimeHours}
                onChange={(v) => setDraft((d) => ({ ...d, leadTimeHours: v }))}
                placeholder="e.g. 8"
              />
              <NumericField
                id="dora-cfr"
                label="Change-fail rate (%)"
                value={draft.changeFailRatePct}
                onChange={(v) => setDraft((d) => ({ ...d, changeFailRatePct: v }))}
                placeholder="e.g. 12"
              />
              <NumericField
                id="dora-mttr"
                label="MTTR (hours)"
                value={draft.mttrHours}
                onChange={(v) => setDraft((d) => ({ ...d, mttrHours: v }))}
                placeholder="e.g. 2"
              />
            </div>
            <div>
              <Label htmlFor="dora-desc" className="text-xs text-sub">
                Description (optional)
              </Label>
              <Textarea
                id="dora-desc"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="What changed this quarter? Notable releases, incidents, etc."
                rows={3}
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
              // R11-fix: commit any in-progress NumericField draft
              // BEFORE the click handler reads parent state. The
              // inner NumericField components commit-on-blur via
              // setState, but click handlers in the same event loop
              // read the OLD closure (React batches the queued
              // setState until after the handler returns). Pressing
              // Add without first Tab-ing away would silently drop
              // the typed value. Using onMouseDown to blur the
              // active element FIRST flushes the commit into draft
              // before the click handler runs.
              onMouseDown={() => {
                const active = document.activeElement as HTMLElement | null;
                if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
                  active.blur();
                }
              }}
              onClick={addSample}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add sample
            </Button>
          </div>
        </SectionCard>

        <ChartCard title="Trend across quarters" height={320}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
            <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
            <XAxis dataKey="quarter" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
            {/* Left axis: deploy frequency (per week) and lead time (hours). */}
            <YAxis yAxisId="left" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
            {/* Right axis: CFR (%) and MTTR (hours) — distinct scales/units. */}
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
            />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
            <Legend wrapperStyle={chartTheme.legendStyle} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="deployFreqPerWeek"
              name="Deploy/wk"
              stroke={chartTheme.colors.cyan}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="leadTimeHours"
              name="Lead (h)"
              stroke={chartTheme.colors.amber}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="changeFailRatePct"
              name="CFR (%)"
              stroke={chartTheme.colors.red}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="mttrHours"
              name="MTTR (h)"
              stroke={chartTheme.colors.purple}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            {/* XmR control limits on deploy frequency — most actionable SPC. */}
            {deployControl && (
              <>
                <ReferenceLine
                  yAxisId="left"
                  y={deployControl.centerLine}
                  stroke={chartTheme.colors.cyan}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: "X̄",
                    fill: chartTheme.colors.cyan,
                    fontSize: 10,
                    position: "right",
                  }}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  yAxisId="left"
                  y={deployControl.ucl}
                  stroke={chartTheme.colors.green}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: "UCL",
                    fill: chartTheme.colors.green,
                    fontSize: 10,
                    position: "right",
                  }}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  yAxisId="left"
                  y={deployControl.lcl}
                  stroke={chartTheme.colors.red}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: "LCL",
                    fill: chartTheme.colors.red,
                    fontSize: 10,
                    position: "right",
                  }}
                  ifOverflow="extendDomain"
                />
              </>
            )}
            {/* CUSUM regime-shift markers on the deploy series. */}
            {deployChangepoints.map((cp, i) => (
              <CausalLine key={`cusum-${i}`} annotation={cp} />
            ))}
          </LineChart>
        </ChartCard>
      </div>

      {sorted.length > 0 && (
        <SectionCard title="Samples" titleSize="lg" className="mt-6">
          <div className="table-wrap-responsive -mx-4 px-4">
            <table className="w-full text-xs min-w-full md:min-w-[640px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Quarter</th>
                  <th className="py-2 pr-3">Deploy/wk</th>
                  <th className="py-2 pr-3">Lead (h)</th>
                  <th className="py-2 pr-3">CFR</th>
                  <th className="py-2 pr-3">MTTR (h)</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {[...sorted].reverse().map((s) => (
                  <tr key={s.id} className="border-b border-border">
                    <td className="py-2 pr-3 font-data text-text">{s.quarter}</td>
                    <td className="py-2 pr-3 font-data">{s.deployFreqPerWeek.toFixed(2)}</td>
                    <td className="py-2 pr-3 font-data">{s.leadTimeHours.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-data">{(s.changeFailRate * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-3 font-data">{s.mttrHours.toFixed(1)}</td>
                    <td className="py-2 pr-3 text-sub max-w-[260px]">
                      <span className="line-clamp-2 break-words whitespace-pre-wrap">
                        {s.description ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSample(s.id)}
                        aria-label={`Remove sample for ${s.quarter}`}
                        className="h-7 w-7 p-0 text-sub hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}

/**
 * Mann-Kendall trend chip. Renders an arrow with directionality color-coded
 * for whether the trend is desirable (deploy/wk up = good; lead time, CFR,
 * MTTR up = bad). Muted when the test isn't significant.
 */
function TrendChip({
  label,
  trend,
  significant,
  betterDown = false,
}: {
  label: string;
  trend: "up" | "down" | "none";
  significant: boolean;
  betterDown?: boolean;
}) {
  if (!significant || trend === "none") {
    return (
      <Badge
        variant="outline"
        className="font-mono text-[10px] tracking-wider uppercase text-sub border-border"
      >
        {label} flat
      </Badge>
    );
  }
  const isFavorable = betterDown ? trend === "down" : trend === "up";
  const arrow = trend === "up" ? "↗" : "↘";
  const tone = isFavorable
    ? "border-success/40 text-success bg-success/10"
    : "border-warning/40 text-warning bg-warning/10";
  return (
    <Badge variant="outline" className={`font-mono text-[10px] tracking-wider uppercase ${tone}`}>
      {label} {arrow} significant
    </Badge>
  );
}

/**
 * String-draft numeric field. Keeps the raw value in state so users can
 * delete/retype freely without an in-flight clamp snapping the cursor.
 */
function NumericField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // BUG-T2-dora-scorecard-1: commit to the parent on EVERY keystroke,
  // not on blur. The prior buffered-on-blur pattern combined with an
  // onMouseDown blur-flush trick on the Add button didn't actually
  // flush because React's setState from the blur handler queues until
  // the next render, but the click handler reads parent state from the
  // SAME render (the previous render's closure). Result: clicking Add
  // without first Tab-ing away silently dropped the in-progress value.
  // Per-keystroke commit eliminates the race; the cost is one extra
  // parent setState per keystroke, which is negligible for a 5-field
  // form.
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-sub">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="bg-surface border-border font-data"
      />
    </div>
  );
}
