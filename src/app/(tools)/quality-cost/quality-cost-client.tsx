"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
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
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DollarSign, ShieldCheck, AlertTriangle } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateQualityCostPrompts } from "@/lib/ai-prompts/quality-cost";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { QUALITY_COST_ACTIONS } from "@/lib/history/event-actions";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface QualityCostInput {
  preventionCost: number;
  detectionCost: number;
  internalFailureCost: number;
  externalFailureCost: number;
  description?: string;
}

const DEFAULT_STATE: QualityCostInput = {
  preventionCost: 0,
  detectionCost: 0,
  internalFailureCost: 0,
  externalFailureCost: 0,
};

const COLOR_MAP = {
  prevention: "#34d399",
  detection: "#00f0ff",
  internal: "#f59e0b",
  external: "#ef4444",
};

/* ── String-draft money input ───────────────────────────────────────────── */

function MoneyField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(value));
      return;
    }
    const rounded = Math.round(n * 100) / 100;
    setDraft(String(rounded));
    // Skip the onChange (and history log entry) when the value didn't
    // actually change — pure focus/blur cycles shouldn't add noise.
    if (rounded === value) return;
    onChange(rounded);
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-sub">
        {label}
      </Label>
      <div className="relative">
        <span
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sub text-xs"
          aria-hidden="true"
        >
          $
        </span>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="bg-bg border-border font-data pl-6"
        />
      </div>
      {hint && <div className="text-[10px] text-sub">{hint}</div>}
    </div>
  );
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function QualityCostClient() {
  const [state, setState] = usePersisted<QualityCostInput>(
    "agile-toolkit:quality-cost",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("quality-cost");
  const chartRef = useRef<HTMLDivElement>(null);

  const update = (patch: Partial<QualityCostInput>) => {
    setState((s) => ({ ...s, ...patch }));
    log(QUALITY_COST_ACTIONS.COST_UPDATED, { fields: Object.keys(patch) });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const total =
    state.preventionCost +
    state.detectionCost +
    state.internalFailureCost +
    state.externalFailureCost;
  const conformance = state.preventionCost + state.detectionCost;
  const nonConformance = state.internalFailureCost + state.externalFailureCost;

  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  const pieData = useMemo(
    () => [
      { name: "Prevention", value: state.preventionCost, color: COLOR_MAP.prevention },
      { name: "Detection", value: state.detectionCost, color: COLOR_MAP.detection },
      {
        name: "Internal failure",
        value: state.internalFailureCost,
        color: COLOR_MAP.internal,
      },
      {
        name: "External failure",
        value: state.externalFailureCost,
        color: COLOR_MAP.external,
      },
    ].filter((d) => d.value > 0),
    [state]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Cost of Quality Calculator",
      prompts: generateQualityCostPrompts({
        prevention: state.preventionCost,
        detection: state.detectionCost,
        internalFailure: state.internalFailureCost,
        externalFailure: state.externalFailureCost,
        total,
        conformance,
        nonConformance,
        description: state.description,
      }),
    }),
    [state, total, conformance, nonConformance]
  );

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <ToolPageWrapper
      toolId="quality-cost"
      title="Cost of Quality Calculator"
      description="Enter costs across prevention, detection, and failure categories to see the conformance ratio and total COQ."
      category="Quality Engineering"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="quality-cost"
          csvData={{
            headers: ["Category", "Cost ($)", "% of Total"],
            rows: [
              ["Prevention", state.preventionCost, pct(state.preventionCost).toFixed(1)],
              ["Detection", state.detectionCost, pct(state.detectionCost).toFixed(1)],
              [
                "Internal failure",
                state.internalFailureCost,
                pct(state.internalFailureCost).toFixed(1),
              ],
              [
                "External failure",
                state.externalFailureCost,
                pct(state.externalFailureCost).toFixed(1),
              ],
              ["Total", total, "100.0"],
              ["Conformance", conformance, pct(conformance).toFixed(1)],
              ["Non-conformance", nonConformance, pct(nonConformance).toFixed(1)],
            ],
          }}
          jsonData={state}
          targetRef={chartRef}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={DollarSign}
          label="Total cost"
          value={`$${fmt(total)}`}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={ShieldCheck}
          label="Conformance"
          value={`$${fmt(conformance)}`}
          hint={`${pct(conformance).toFixed(0)}% of total`}
          tone={pct(conformance) >= 70 ? "success" : "default"}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Non-conformance"
          value={`$${fmt(nonConformance)}`}
          hint={`${pct(nonConformance).toFixed(0)}% of total`}
          tone={pct(nonConformance) > 30 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          label="External / Internal"
          value={
            state.internalFailureCost > 0
              ? (state.externalFailureCost / state.internalFailureCost).toFixed(2)
              : "—"
          }
          hint={
            state.internalFailureCost === 0 && state.externalFailureCost > 0
              ? "no internal recorded"
              : "ext failures escaping QA"
          }
          tone={
            state.externalFailureCost > state.internalFailureCost &&
            state.externalFailureCost > 0
              ? "danger"
              : "default"
          }
        />
      </KpiGrid>

      <SectionCard
        title="Costs"
        icon={DollarSign}
        className="mb-6 bg-surface border-border"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MoneyField
            id="coq-prevention"
            label="Prevention"
            value={state.preventionCost}
            onChange={(n) => update({ preventionCost: n })}
            hint="Training, code review, design"
          />
          <MoneyField
            id="coq-detection"
            label="Detection"
            value={state.detectionCost}
            onChange={(n) => update({ detectionCost: n })}
            hint="Testing, inspection, audits"
          />
          <MoneyField
            id="coq-internal"
            label="Internal failure"
            value={state.internalFailureCost}
            onChange={(n) => update({ internalFailureCost: n })}
            hint="Rework caught pre-release"
          />
          <MoneyField
            id="coq-external"
            label="External failure"
            value={state.externalFailureCost}
            onChange={(n) => update({ externalFailureCost: n })}
            hint="Bug fixes, refunds, churn"
          />
        </div>
        <div className="space-y-1 mt-4">
          <Label htmlFor="coq-description" className="text-xs text-sub">
            Description (optional)
          </Label>
          <Textarea
            id="coq-description"
            rows={2}
            value={state.description ?? ""}
            onChange={(e) => {
              // Store the raw value while typing — trimming inside onChange
              // strips spaces the user is actively pressing. Normalize the
              // empty-string-to-undefined collapse only on blur.
              const next = e.target.value;
              setState((s) => ({ ...s, description: next }));
            }}
            onBlur={(e) => {
              const trimmed = e.target.value.trim();
              setState((s) => ({
                ...s,
                description: trimmed ? trimmed : undefined,
              }));
            }}
            placeholder="Period covered, scope, sources of estimates..."
            className="bg-bg border-border text-sm"
          />
        </div>
      </SectionCard>

      {pieData.length > 0 && (
        <ChartCard
          title="Cost distribution"
          icon={DollarSign}
          height={320}
          chartContainerRef={chartRef}
          className="mb-6"
        >
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={110}
              innerRadius={60}
              paddingAngle={2}
              label={({ name, percent }) =>
                `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
              }
            >
              {pieData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={chartTheme.tooltipStyle}
              formatter={(v) => {
                const n = typeof v === "number" ? v : Number(v);
                return Number.isFinite(n) ? `$${fmt(n)}` : "—";
              }}
            />
            <Legend wrapperStyle={chartTheme.legendStyle} />
          </PieChart>
        </ChartCard>
      )}

      <CalloutAlert tone="info">
        <strong>COQ framework:</strong> Cost of Quality splits into{" "}
        <em>conformance</em> (prevention + detection) and <em>non-conformance</em>{" "}
        (internal + external failure). Mature orgs typically run ~70/30 conformance
        to non-conformance. The classic Crosby rule of thumb:{" "}
        <strong>$1 invested in prevention saves about $100 in eventual failure cost.</strong>{" "}
        External failures (the ones customers see) are usually 4-10× more expensive
        than internal ones — so &ldquo;ship faster, fix later&rdquo; rarely pencils out.
      </CalloutAlert>
    </ToolPageWrapper>
  );
}
