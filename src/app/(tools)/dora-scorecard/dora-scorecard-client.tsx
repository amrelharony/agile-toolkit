"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Rocket, Clock, AlertTriangle, Wrench } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateDoraPrompts } from "@/lib/ai-prompts/dora-scorecard";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DORA_ACTIONS } from "@/lib/history/event-actions";

type Band = "Elite" | "High" | "Medium" | "Low";

interface DoraSample {
  id: string;
  quarter: string;
  deployFreqPerWeek: number;
  leadTimeHours: number;
  /** 0-1 fractional change failure rate. */
  changeFailRate: number;
  mttrHours: number;
  description?: string;
}

interface DoraState {
  samples: DoraSample[];
}

const DEFAULT_STATE: DoraState = { samples: [] };

const BAND_TONE: Record<Band, "success" | "default" | "warning" | "danger"> = {
  Elite: "success",
  High: "default",
  Medium: "warning",
  Low: "danger",
};

/* ── Banding helpers ────────────────────────────────────────────────────── */
// Per Accelerate / DORA 2023 report. Upper bounds are inclusive (`<=`) so
// boundary values (e.g. exactly 24h lead time) fall into the better band.
function bandDeploy(perWeek: number): Band {
  // Elite: multiple per day (≥30/wk). High: between weekly and daily.
  // Medium: between monthly (~0.25/wk) and weekly. Low: less than monthly.
  if (perWeek >= 30) return "Elite";
  if (perWeek >= 1) return "High";
  if (perWeek >= 0.25) return "Medium";
  return "Low";
}
function bandLead(hours: number): Band {
  if (hours <= 1) return "Elite";
  if (hours <= 24) return "High";
  if (hours <= 24 * 7) return "Medium";
  return "Low";
}
function bandCfr(rate: number): Band {
  if (rate <= 0.15) return "Elite";
  if (rate <= 0.30) return "High";
  if (rate <= 0.45) return "Medium";
  return "Low";
}
function bandMttr(hours: number): Band {
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
  const [state, setState] = usePersisted<DoraState>(
    "agile-toolkit:dora-scorecard",
    DEFAULT_STATE
  );
  const [draft, setDraft] = useState<DraftState>(makeDraft);
  const { log } = useHistoryLogger("dora-scorecard");

  // Numeric draft commits — clamp on blur, never mid-edit. We store the raw
  // string in `draft` and resolve to a number only inside `addSample`.
  const parsePositive = (v: string): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const parsePercent = (v: string): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, n / 100));
  };

  const addSample = () => {
    const deploy = parsePositive(draft.deployFreqPerWeek);
    const lead = parsePositive(draft.leadTimeHours);
    const cfr = parsePercent(draft.changeFailRatePct);
    const mttr = parsePositive(draft.mttrHours);
    if (deploy === null || lead === null || cfr === null || mttr === null) return;
    if (!draft.quarter.trim()) return;
    const sample: DoraSample = {
      id: crypto.randomUUID(),
      quarter: draft.quarter.trim(),
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
                onChange={(e) =>
                  setDraft((d) => ({ ...d, quarter: e.target.value }))
                }
                placeholder="2026-Q1"
                className="bg-surface border-border"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumericField
                id="dora-deploy"
                label="Deploys / week"
                value={draft.deployFreqPerWeek}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, deployFreqPerWeek: v }))
                }
                placeholder="e.g. 12"
              />
              <NumericField
                id="dora-lead"
                label="Lead time (hours)"
                value={draft.leadTimeHours}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, leadTimeHours: v }))
                }
                placeholder="e.g. 8"
              />
              <NumericField
                id="dora-cfr"
                label="Change-fail rate (%)"
                value={draft.changeFailRatePct}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, changeFailRatePct: v }))
                }
                placeholder="e.g. 12"
              />
              <NumericField
                id="dora-mttr"
                label="MTTR (hours)"
                value={draft.mttrHours}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, mttrHours: v }))
                }
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
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="What changed this quarter? Notable releases, incidents, etc."
                rows={3}
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
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
            <YAxis
              yAxisId="left"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
            />
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
          </LineChart>
        </ChartCard>
      </div>

      {sorted.length > 0 && (
        <SectionCard title="Samples" titleSize="lg" className="mt-6">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[640px]">
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
                  <tr key={s.id} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-data text-text">{s.quarter}</td>
                    <td className="py-2 pr-3 font-data">{s.deployFreqPerWeek.toFixed(2)}</td>
                    <td className="py-2 pr-3 font-data">{s.leadTimeHours.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-data">
                      {(s.changeFailRate * 100).toFixed(1)}%
                    </td>
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
  const [draft, setDraft] = useState(value);
  // Sync external value changes (e.g. parent reset) into local draft.
  useEffect(() => setDraft(value), [value]);
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-sub">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onChange(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onChange(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="bg-surface border-border font-data"
      />
    </div>
  );
}
