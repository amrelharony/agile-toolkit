"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Triangle, DollarSign } from "lucide-react";
import { generateTestPyramidPrompts } from "@/lib/ai-prompts/test-pyramid";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { TEST_PYRAMID_ACTIONS } from "@/lib/history/event-actions";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface TestCounts {
  unit: number;
  integration: number;
  e2e: number;
  description?: string;
}

const DEFAULT_STATE: TestCounts = {
  unit: 0,
  integration: 0,
  e2e: 0,
};

const TP_ID = "testPyramid:current"; // MUST match TP_ID in test-pyramid.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// count writes round-trip into the UI. Drop-in [state, setState].
function useTestPyramid(): [TestCounts, (u: TestCounts | ((p: TestCounts) => TestCounts)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.testPyramids ?? []).find((d) => d.id === TP_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertTestPyramid);
  const toCounts = (d: typeof doc): TestCounts =>
    d
      ? { unit: d.unit, integration: d.integration, e2e: d.e2e, description: d.description }
      : DEFAULT_STATE;
  const state = toCounts(doc);
  const setState = (u: TestCounts | ((p: TestCounts) => TestCounts)) => {
    const cur = (useWorkspaceStore.getState().testPyramids ?? []).find((d) => d.id === TP_ID);
    const next = typeof u === "function" ? u(toCounts(cur)) : u;
    upsert({ id: TP_ID, ...next });
  };
  return [state, setState];
}

// Cost-of-quality coefficients per the brief.
const COST_PER_UNIT = 1;
const COST_PER_INTEGRATION = 5;
const COST_PER_E2E = 25;

/* ── String-draft numeric input ─────────────────────────────────────────── */

function NumericField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  // Local string draft so the user can backspace mid-edit without snapping
  // back to the clamped value.
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
    const rounded = Math.max(0, Math.round(n));
    setDraft(String(rounded));
    onChange(rounded);
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-sub">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
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
        className="bg-bg border-border font-data"
      />
      {hint && <div className="text-xs text-sub">{hint}</div>}
    </div>
  );
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function TestPyramidClient() {
  const [state, setState] = useTestPyramid();
  const { log } = useHistoryLogger("test-pyramid");

  const update = (patch: Partial<TestCounts>) => {
    setState((s) => ({ ...s, ...patch }));
    log(TEST_PYRAMID_ACTIONS.COUNT_UPDATED, {
      fields: Object.keys(patch),
    });
  };

  // Local raw-text draft for the description so intermediate spaces survive
  // mid-edit. We sync from persisted state when the field isn't focused, and
  // normalize (trim → undefined) only on blur.
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [descDraft, setDescDraft] = useState<string>(state.description ?? "");
  const lastDescRef = useRef<string>(state.description ?? "");
  useEffect(() => {
    if (document.activeElement === descRef.current) return;
    const next = state.description ?? "";
    if (next === lastDescRef.current) return;
    setDescDraft(next);
    lastDescRef.current = next;
  }, [state.description]);

  const commitDescription = () => {
    const raw = descDraft;
    const next = raw.trim() ? raw : undefined;
    lastDescRef.current = next ?? "";
    setState((s) => ({ ...s, description: next }));
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const total = state.unit + state.integration + state.e2e;
  const unitPct = total ? (state.unit / total) * 100 : 0;
  const integrationPct = total ? (state.integration / total) * 100 : 0;
  const e2ePct = total ? (state.e2e / total) * 100 : 0;
  const inverted = state.e2e > state.unit && total > 0;
  const costEstimate =
    state.unit * COST_PER_UNIT +
    state.integration * COST_PER_INTEGRATION +
    state.e2e * COST_PER_E2E;

  /* ── Pyramid bar widths ─────────────────────────────────────────────── */

  // Each bar's width is its % of the largest layer count, so the visualization
  // always has at least one full-width row even when the absolute counts are
  // small. Empty layers render at 0% width.
  const maxCount = Math.max(state.unit, state.integration, state.e2e, 1);
  const barWidth = (n: number) => `${(n / maxCount) * 100}%`;

  // Color by ideal-shape compliance.
  // - E2E green if ≤ unit; red if > unit (inverted).
  // - Integration green if between e2e and unit.
  // - Unit always green when it's the largest layer.
  // When total is 0 there's nothing to evaluate — use a neutral tone instead
  // of misleading "all green".
  const NEUTRAL_COLOR = "#6b7280";
  const e2eColor = total === 0 ? NEUTRAL_COLOR : inverted ? "#ef4444" : "#34d399";
  const intColor =
    total === 0
      ? NEUTRAL_COLOR
      : state.integration <= state.unit && state.integration >= state.e2e
        ? "#34d399"
        : "#facc15";
  const unitColor =
    total === 0 ? NEUTRAL_COLOR : state.unit >= state.integration ? "#34d399" : "#facc15";

  const promptConfig = useMemo(
    () => ({
      toolName: "Test Pyramid Analyzer",
      prompts: generateTestPyramidPrompts({
        unit: state.unit,
        integration: state.integration,
        e2e: state.e2e,
        total,
        unitPct,
        e2ePct,
        inverted,
        costEstimate,
        description: state.description,
      }),
    }),
    [state, total, unitPct, e2ePct, inverted, costEstimate]
  );

  return (
    <ToolPageWrapper
      toolId="test-pyramid"
      title="Test Pyramid Analyzer"
      description="Enter your test counts per layer; surface inverted-pyramid anti-patterns and a cost-of-quality estimate."
      category="Quality Engineering"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="test-pyramid"
          csvData={{
            headers: ["Layer", "Count", "% of Total", "Cost Units"],
            rows: [
              ["Unit", state.unit, unitPct.toFixed(1), state.unit * COST_PER_UNIT],
              [
                "Integration",
                state.integration,
                integrationPct.toFixed(1),
                state.integration * COST_PER_INTEGRATION,
              ],
              ["E2E", state.e2e, e2ePct.toFixed(1), state.e2e * COST_PER_E2E],
              ["Total", total, total === 0 ? "0.0" : "100.0", costEstimate],
            ],
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={Triangle}
          label="Total tests"
          value={total}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="% unit"
          value={`${unitPct.toFixed(0)}%`}
          tone={unitPct >= 60 ? "success" : "default"}
        />
        <StatCard
          variant="compact"
          label="% e2e"
          value={`${e2ePct.toFixed(0)}%`}
          tone={e2ePct > 20 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={DollarSign}
          label="Cost-of-quality"
          value={costEstimate}
          hint="unit=1, int=5, e2e=25"
        />
      </KpiGrid>

      {inverted && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>Inverted pyramid detected:</strong> e2e count ({state.e2e}) exceeds unit count (
          {state.unit}). Slow feedback loops and brittle tests are likely.
        </CalloutAlert>
      )}

      <SectionCard title="Test counts" icon={Triangle} className="mb-6 bg-surface border-border">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumericField
            id="pyramid-unit"
            label="Unit tests"
            value={state.unit}
            onChange={(n) => update({ unit: n })}
            hint="Fast, isolated, in-process."
          />
          <NumericField
            id="pyramid-integration"
            label="Integration tests"
            value={state.integration}
            onChange={(n) => update({ integration: n })}
            hint="Multiple components or services."
          />
          <NumericField
            id="pyramid-e2e"
            label="E2E tests"
            value={state.e2e}
            onChange={(n) => update({ e2e: n })}
            hint="Full stack, real browser/API."
          />
        </div>
        <div className="space-y-1 mt-4">
          <Label htmlFor="pyramid-description" className="text-xs text-sub">
            Description (optional)
          </Label>
          <Textarea
            id="pyramid-description"
            ref={descRef}
            rows={2}
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDescription}
            placeholder="Repo, snapshot date, framework notes..."
            className="bg-bg border-border text-sm"
          />
        </div>
      </SectionCard>

      <SectionCard title="Pyramid shape" icon={Triangle} className="mb-6 bg-surface border-border">
        {total === 0 ? (
          <div className="text-xs text-sub py-6 text-center">
            Enter counts above to render the pyramid.
          </div>
        ) : (
          <div className="space-y-3">
            {/* E2E (top, smallest) */}
            <PyramidBar
              label="E2E"
              count={state.e2e}
              pct={e2ePct}
              width={barWidth(state.e2e)}
              color={e2eColor}
            />
            {/* Integration (middle) */}
            <PyramidBar
              label="Integration"
              count={state.integration}
              pct={integrationPct}
              width={barWidth(state.integration)}
              color={intColor}
            />
            {/* Unit (bottom, largest) */}
            <PyramidBar
              label="Unit"
              count={state.unit}
              pct={unitPct}
              width={barWidth(state.unit)}
              color={unitColor}
            />
          </div>
        )}
      </SectionCard>

      <CalloutAlert tone="info">
        <strong>How to read this:</strong> a healthy test suite is unit-heavy (60-80% unit), with a
        thin layer of e2e. The cost estimate uses the relative-cost rule of thumb — unit=1,
        integration=5, e2e=25 — so a high cost number signals slow feedback loops, not just spend.
      </CalloutAlert>
    </ToolPageWrapper>
  );
}

/* ── Pyramid bar ────────────────────────────────────────────────────────── */

function PyramidBar({
  label,
  count,
  pct,
  width,
  color,
}: {
  label: string;
  count: number;
  pct: number;
  width: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs text-sub uppercase tracking-wider shrink-0">{label}</div>
      <div className="flex-1 min-w-0 h-8 bg-bg/60 rounded relative overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width, background: `${color}55`, borderRight: `2px solid ${color}` }}
          aria-label={`${label}: ${count} (${pct.toFixed(0)}%)`}
        />
        <div className="absolute inset-0 flex items-center px-2 text-xs font-data">
          <span className="text-text">{count}</span>
          <span className="text-sub ml-2">({pct.toFixed(0)}%)</span>
        </div>
      </div>
    </div>
  );
}
