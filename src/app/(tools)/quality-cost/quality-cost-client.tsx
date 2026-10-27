"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, DollarSign, Pencil, ShieldCheck, Trash2, TrendingUp } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ChartCard, ChartFigure } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { QuarterPicker } from "@/components/shared/quarter-picker";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { generateQualityCostPrompts } from "@/lib/ai-prompts/quality-cost";
import { QUALITY_COST_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABEL,
  FAILURE_SHARE_HIGH,
  LEGACY_COST_FIELD,
  QUALITY_COST_KEY,
  costBreakdown,
  costPeriodErrors,
  failureShareTrend,
  failureShareVerdict,
  legacyCosts,
  newQualityCostPeriodId,
  normalizeQualityCostState,
  typedCostQuarter,
  withoutLegacyCosts,
  type CostFigures,
  type QualityCostPeriod,
  type QualityCostState,
} from "@/lib/quality/cost";
import { currentQuarter } from "@/lib/roadmap/quarters";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { parseNumber } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import { usePersisted } from "@/lib/utils/use-persisted";
import { buildExample } from "./example";
import { qualityCostMarkdown } from "./markdown";
import { PeriodForm, type PeriodValues } from "./period-form";
import {
  amountText,
  distributionText,
  failureShareChartText,
  isHighShare,
  money,
  periodRows,
  sharePct,
  sideAmount,
  sideText,
  type PeriodRow,
} from "./view";

// Recharts loads with each chart, not the page; the fixed-height boxes
// reserve the space while it does.
const CostDistributionChart = dynamic(
  () => import("./charts").then((m) => m.CostDistributionChart),
  { ssr: false }
);
const FailureShareChart = dynamic(() => import("./charts").then((m) => m.FailureShareChart), {
  ssr: false,
});

/** Quarters with a failure share before the line is drawn: one point is the verdict's job. */
const CHART_MIN_POINTS = 2;

type Update = (fn: (s: QualityCostState) => QualityCostState) => void;

/** Whether `period` is logged already (a revert never puts back a second copy of a quarter). */
const taken = (s: QualityCostState, period: string) =>
  (s.periods ?? []).some((p) => p.period === period);

/** Focus what `find` returns once React has re-rendered (the focused control may have gone). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

const firstFieldOf = (root: HTMLElement | null) =>
  root?.querySelector<HTMLElement>("select, input, textarea");

/**
 * The quarters' Edit buttons, one per quarter in screen order. The table
 * and its phone cards both render them (one of the two hidden), so the
 * ones on screen are used when any are.
 */
function editButtons(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-edit-period]"));
  const shown = all.filter((el) => el.getClientRects().length > 0);
  const seen = new Set<string>();
  return (shown.length > 0 ? shown : all).filter((el) => {
    const id = el.getAttribute("data-edit-period") ?? "";
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const editButtonOf = (id: string) =>
  editButtons().find((el) => el.getAttribute("data-edit-period") === id);

/** Focus the Edit button of quarter `id` once React has re-rendered. */
function focusEditButton(id: string) {
  focusSoon(() => editButtonOf(id));
}

/** The quarter after `id` on screen, else the one before it: where focus goes when it is deleted. */
function neighbourPeriod(id: string): string | null {
  const ids = editButtons().map((el) => el.getAttribute("data-edit-period"));
  const at = ids.indexOf(id);
  return (at < 0 ? null : (ids[at + 1] ?? ids[at - 1])) ?? null;
}

/** Focus the first control under `root` once it has mounted (an editor just opened). */
function useFocusFirst<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
  }, []);
  return ref;
}

export function QualityCostClient() {
  // The page's own cloud-synced blob: no other tool writes it, and agents
  // read it (tool.quality_cost.list_periods). Read through the normaliser,
  // so the old single-period shape and stray values load safely.
  const [raw, setRaw] = usePersisted<unknown>(QUALITY_COST_KEY, {});
  const saved = useMemo(() => normalizeQualityCostState(raw), [raw]);
  // The example lives here only: nothing in it reaches the blob.
  const [example, setExample] = useState<QualityCostState | null>(null);
  const preview = example !== null;
  const state = useMemo(
    () => (example ? normalizeQualityCostState(example) : saved),
    [example, saved]
  );
  const periods = useMemo(() => state.periods ?? [], [state.periods]);
  const legacy = preview ? null : legacyCosts(saved);

  const { log: logHistory } = useHistoryLogger("quality-cost");
  // The example's edits aren't the team's history, so they aren't logged.
  const log: typeof logHistory = (...args) => {
    if (!preview) logHistory(...args);
  };
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Bound to the mode the change was made in, so an Undo still lands in the
  // same place if the example is loaded or cleared in between.
  const write: Update = preview
    ? (fn) => setExample((ex) => (ex ? fn(normalizeQualityCostState(ex)) : ex))
    : (fn) => setRaw((prev: unknown) => fn(normalizeQualityCostState(prev)));
  const newId = () => (preview ? exampleId(`qcp-${nanoid(6)}`) : newQualityCostPeriodId());

  const rows = useMemo(() => periodRows(periods), [periods]);
  const trend = useMemo(() => failureShareTrend(periods), [periods]);
  const scored = trend.points.filter((p) => p.share !== null).length;
  const verdict =
    failureShareVerdict(trend) ??
    (periods.length === 0
      ? "No quarters logged yet."
      : "Enter a prevention or detection cost and a failure cost in a quarter to see its failure share.");
  const shown = periods.find((p) => p.id === shownId) ?? periods[periods.length - 1];
  const editing = periods.find((p) => p.id === editingId);

  /* ── Changes ── */

  function addPeriod(values: PeriodValues) {
    const period: QualityCostPeriod = { id: newId(), ...values };
    write((s) => ({ ...s, periods: [...(s.periods ?? []), period] }));
    log(QUALITY_COST_ACTIONS.PERIOD_SAVED, { periodId: period.id, period: period.period });
    setShownId(period.id);
    announce(`Saved ${period.period}`);
  }

  function savePeriod(id: string, values: PeriodValues) {
    write((s) => ({
      ...s,
      periods: (s.periods ?? []).map((p) => (p.id === id ? { id, ...values } : p)),
    }));
    log(QUALITY_COST_ACTIONS.PERIOD_SAVED, { periodId: id, period: values.period });
    announce(`Saved ${values.period}`);
    closeEditor(id);
  }

  function closeEditor(id: string) {
    setEditingId(null);
    focusEditButton(id);
  }

  function removePeriod(p: QualityCostPeriod) {
    if (editingId === p.id) setEditingId(null);
    // The focused Delete button goes with its row: focus moves to the
    // neighbouring quarter's Edit, or to the form once none are left.
    const near = neighbourPeriod(p.id);
    focusSoon(() => (near && editButtonOf(near)) || firstFieldOf(formRef.current));
    undoable({
      label: `Deleted ${p.period}`,
      apply: () => {
        write((s) => ({ ...s, periods: (s.periods ?? []).filter((x) => x.id !== p.id) }));
        log(QUALITY_COST_ACTIONS.PERIOD_REMOVED, { periodId: p.id, period: p.period });
      },
      revert: () =>
        write((s) => (taken(s, p.period) ? s : { ...s, periods: [...(s.periods ?? []), p] })),
    });
    announce(`Deleted ${p.period}`);
  }

  /** Each clear keeps what it took for its own Undo (impediments' deleteAll explains why). */
  function clearHistory() {
    const removed = periods;
    setEditingId(null);
    undoable({
      label: `Cleared ${removed.length === 1 ? "1 quarter" : `${removed.length} quarters`}`,
      apply: () => {
        write((s) => ({ ...s, periods: [] }));
        log(QUALITY_COST_ACTIONS.QUALITY_COST_RESET, { periods: removed.length });
      },
      revert: () =>
        write((s) => ({
          ...s,
          periods: [...(s.periods ?? []), ...removed.filter((p) => !taken(s, p.period))],
        })),
    });
    // The history and its Clear button give way to the empty state.
    focusSoon(() => firstFieldOf(formRef.current));
  }

  function setRate(rate: number | undefined) {
    write((s) => {
      const next = { ...s };
      if (rate === undefined) delete next.hourlyRate;
      else next.hourlyRate = rate;
      return next;
    });
    log(QUALITY_COST_ACTIONS.COST_UPDATED, { fields: ["hourlyRate"] });
  }

  function saveLegacy(period: string) {
    const costs = legacyCosts(saved);
    if (!costs) return;
    const note = saved.description?.trim();
    const row: QualityCostPeriod = {
      id: newQualityCostPeriodId(),
      period,
      costs,
      ...(note ? { note } : {}),
    };
    setRaw((prev: unknown) => {
      const s = normalizeQualityCostState(prev);
      return { ...withoutLegacyCosts(s), periods: [...(s.periods ?? []), row] };
    });
    log(QUALITY_COST_ACTIONS.PERIOD_SAVED, { periodId: row.id, period, fromLegacy: true });
    setShownId(row.id);
    announce(`Saved the earlier figures as ${period}`);
  }

  function discardLegacy() {
    const before: Partial<QualityCostState> = { description: saved.description };
    for (const c of COST_CATEGORIES) before[LEGACY_COST_FIELD[c]] = saved[LEGACY_COST_FIELD[c]];
    undoable({
      label: "Discarded the earlier figures",
      apply: () => setRaw((prev: unknown) => withoutLegacyCosts(normalizeQualityCostState(prev))),
      revert: () => setRaw((prev: unknown) => ({ ...normalizeQualityCostState(prev), ...before })),
    });
  }

  /* ── Exports ── */

  const shownBreakdown = shown ? costBreakdown(shown.costs) : null;
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
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Cost of Quality Calculator",
      prompts:
        shown && shownBreakdown
          ? generateQualityCostPrompts(
              {
                prevention: shown.costs.prevention ?? 0,
                detection: shown.costs.detection ?? 0,
                internalFailure: shown.costs.internalFailure ?? 0,
                externalFailure: shown.costs.externalFailure ?? 0,
                total: shownBreakdown.total,
                conformance: shownBreakdown.conformance,
                nonConformance: shownBreakdown.nonConformance,
                description: [shown.period, shown.note].filter(Boolean).join(": "),
              },
              workspace
            )
          : [],
    }),
    [shown, shownBreakdown, workspace]
  );

  const csvData = {
    headers: [
      "Quarter",
      ...COST_CATEGORIES.map((c) => COST_CATEGORY_LABEL[c]),
      "Total",
      "Conformance",
      "Non-conformance",
      "Failure share (%)",
      "Note",
    ],
    rows: rows.map(({ period: p, breakdown: b }) => [
      p.period,
      ...COST_CATEGORIES.map((c) => p.costs[c] ?? ""),
      b.total,
      // A side with nothing entered is a blank cell, never 0.
      sideAmount(p.costs, "conformance") ?? "",
      sideAmount(p.costs, "nonConformance") ?? "",
      b.failureShare === null ? "" : Math.round(b.failureShare * 1000) / 10,
      p.note ?? "",
    ]),
  };

  const columns: DataTableColumn<PeriodRow>[] = [
    { key: "period", header: "Quarter", primary: true, cell: (r) => r.period.period },
    ...COST_CATEGORIES.map(
      (c): DataTableColumn<PeriodRow> => ({
        key: c,
        header: COST_CATEGORY_LABEL[c],
        hiddenBelow: "lg",
        align: "right",
        cell: (r) => (
          <span className={r.period.costs[c] === undefined ? "text-sub" : "font-data"}>
            {amountText(r.period.costs, c)}
          </span>
        ),
      })
    ),
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (r) => <span className="font-data">{money(r.breakdown.total)}</span>,
    },
    {
      key: "share",
      header: "Failure share",
      align: "right",
      cell: (r) => (
        <span
          className={isHighShare(r.breakdown.failureShare) ? "font-data text-danger" : "font-data"}
        >
          {r.breakdown.failureShare === null ? "—" : sharePct(r.breakdown.failureShare)}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      sortLabel: "Actions",
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          <Button
            data-edit-period={r.period.id}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Edit ${r.period.period}`}
            aria-expanded={editingId === r.period.id}
            onClick={() => setEditingId(r.period.id)}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <IconButton
            label={`Delete ${r.period.period}`}
            icon={<Trash2 aria-hidden="true" />}
            onClick={() => removePeriod(r.period)}
            className="text-sub hover:text-danger"
          />
        </span>
      ),
    },
  ];

  const shareChart = failureShareChartText(trend);
  const split = shown ? distributionText(shown.costs, shown.period) : null;

  return (
    <ToolPageWrapper
      toolId="quality-cost"
      title="Cost of Quality Calculator"
      description="Log prevention, detection and failure costs quarter by quarter to see the failure share of your quality spend and where it is heading."
      category="Quality Engineering"
    >
      <div ref={exportRef} className="space-y-6">
        {preview && (
          <ExampleNotice
            onClear={() => {
              setExample(null);
              setEditingId(null);
              setShownId(null);
            }}
          />
        )}
        {legacy && (
          <LegacyNotice
            costs={legacy}
            description={saved.description}
            periods={saved.periods ?? []}
            onSave={saveLegacy}
            onDiscard={discardLegacy}
          />
        )}

        <SectionCard title="Log a quarter" icon={DollarSign} contentClassName="space-y-4">
          <RateField
            rate={state.hourlyRate}
            onCommit={setRate}
            key={preview ? "example" : "saved"}
          />
          <div ref={formRef}>
            <PeriodForm
              key={preview ? "example-form" : "form"}
              periods={periods}
              hourlyRate={state.hourlyRate}
              onSave={addPeriod}
            />
          </div>
        </SectionCard>

        {periods.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            action={<LoadExampleButton onLoad={() => setExample(buildExample())} />}
          >
            No quarters logged yet. Save a quarter&apos;s figures above to start the history, or
            load an example to see six quarters with a trend.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm font-medium text-text">{verdict}</p>

            {shown && shownBreakdown && (
              <section aria-labelledby="coq-shown-heading" className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 id="coq-shown-heading" className="text-base font-display text-text">
                    {shown.period}
                  </h2>
                  {periods.length > 1 && (
                    <Field label="Quarter shown" className="w-full sm:w-48">
                      {(props) => (
                        <select
                          {...props}
                          className="flex h-11 w-full rounded-md border border-input bg-background px-3 font-data text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm"
                          value={shown.id}
                          onChange={(e) => setShownId(e.target.value)}
                        >
                          {[...periods].reverse().map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.period}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}
                </div>
                <KpiGrid cols={4}>
                  <StatCard
                    variant="compact"
                    icon={DollarSign}
                    label="Total cost"
                    value={money(shownBreakdown.total)}
                    hint={
                      shownBreakdown.missing.length === 0
                        ? "All four entered"
                        : `${shownBreakdown.missing.length} of 4 not entered`
                    }
                    valueClassName="text-accent"
                  />
                  <StatCard
                    variant="compact"
                    icon={ShieldCheck}
                    label="Conformance"
                    value={sideText(shown.costs, "conformance")}
                    hint={
                      shownBreakdown.failureShare === null
                        ? "Share needs a cost on each side"
                        : `${sharePct(1 - shownBreakdown.failureShare)} of total`
                    }
                    tone={
                      shownBreakdown.failureShare !== null &&
                      shownBreakdown.failureShare <= FAILURE_SHARE_HIGH
                        ? "success"
                        : "default"
                    }
                  />
                  <StatCard
                    variant="compact"
                    icon={AlertTriangle}
                    label="Non-conformance"
                    value={sideText(shown.costs, "nonConformance")}
                    hint={
                      shownBreakdown.failureShare === null
                        ? "Share needs a cost on each side"
                        : `${sharePct(shownBreakdown.failureShare)} of total`
                    }
                    tone={isHighShare(shownBreakdown.failureShare) ? "danger" : "default"}
                  />
                  <StatCard
                    variant="compact"
                    label="External / internal"
                    value={
                      shownBreakdown.externalToInternal === null
                        ? "—"
                        : shownBreakdown.externalToInternal.toFixed(2)
                    }
                    hint={
                      shownBreakdown.externalToInternal === null
                        ? "Needs both failure costs, internal above $0"
                        : "External failure per $1 of internal"
                    }
                    tone={
                      shownBreakdown.externalToInternal !== null &&
                      shownBreakdown.externalToInternal > 1
                        ? "danger"
                        : "default"
                    }
                  />
                </KpiGrid>
              </section>
            )}

            <SectionCard
              title={`Quarters (${periods.length})`}
              icon={DollarSign}
              contentClassName="space-y-4"
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="quality-cost"
                    csvData={csvData}
                    jsonData={state}
                    markdown={qualityCostMarkdown(state)}
                    targetRef={exportRef}
                  />
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => setConfirmClear(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Clear history
                  </Button>
                  <ConfirmDialog
                    open={confirmClear}
                    onOpenChange={setConfirmClear}
                    title={
                      periods.length === 1
                        ? "Clear the 1 logged quarter?"
                        : `Clear all ${periods.length} logged quarters?`
                    }
                    description="The failure-share trend starts again from nothing. The hourly rate is kept."
                    confirmLabel="Clear history"
                    onConfirm={clearHistory}
                  />
                </>
              }
            >
              <DataTable
                caption="Logged quarters, oldest first"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.period.id}
              />
              {editing && (
                <EditPanel key={editing.id} title={`Edit ${editing.period}`}>
                  <PeriodForm
                    periods={periods}
                    editing={editing}
                    hourlyRate={state.hourlyRate}
                    onSave={(values) => savePeriod(editing.id, values)}
                    onCancel={() => closeEditor(editing.id)}
                  />
                </EditPanel>
              )}
            </SectionCard>

            <SectionCard
              title="Failure share by quarter"
              icon={TrendingUp}
              contentClassName="space-y-4"
            >
              {scored >= CHART_MIN_POINTS ? (
                <ChartFigure
                  label="Failure share by quarter"
                  summary={shareChart.summary}
                  table={shareChart.table}
                  plotClassName="h-[220px]"
                >
                  <FailureShareChart
                    data={trend.points.map((p) => ({
                      period: p.period,
                      share: p.share === null ? null : Math.round(p.share * 100),
                    }))}
                    highPct={Math.round(FAILURE_SHARE_HIGH * 100)}
                  />
                </ChartFigure>
              ) : (
                <NotEnoughData
                  have={scored}
                  need={CHART_MIN_POINTS}
                  unit={["quarter with a failure share", "quarters with a failure share"]}
                  action="Log"
                  what="the failure share over time"
                />
              )}
            </SectionCard>

            {shown && split && split.slices.length > 0 && (
              <ChartCard
                title={`Where ${shown.period}'s quality spend went`}
                icon={DollarSign}
                height={280}
                summary={split.summary}
                table={split.table}
              >
                <CostDistributionChart data={split.slices} formatAmount={money} />
              </ChartCard>
            )}

            <AdvancedAnalysis>
              {trend.trend ? (
                <p className="text-sm text-text">
                  Mann-Kendall over {scored} quarters:{" "}
                  {trend.trend.trend === "none" || !trend.trend.significant
                    ? "no clear trend in the failure share"
                    : `the failure share is trending ${trend.trend.trend}`}{" "}
                  (p = {trend.trend.pValue.toFixed(3)}).
                </p>
              ) : (
                <NotEnoughData
                  have={scored}
                  need="trend"
                  unit={["quarter with a failure share", "quarters with a failure share"]}
                  action="Log"
                  what="a trend test on the failure share"
                />
              )}
            </AdvancedAnalysis>
          </>
        )}

        <CalloutAlert tone="info">
          <strong>COQ framework:</strong> Cost of Quality splits into <em>conformance</em>{" "}
          (prevention + detection, the textbook &ldquo;appraisal&rdquo; category) and{" "}
          <em>non-conformance</em> (internal + external failure). Mature orgs typically run ~70/30
          conformance to non-conformance. The 1-10-100 rule of thumb, usually credited to Labovitz
          and Chang:{" "}
          <strong>
            a defect that costs $1 to prevent costs about $10 to fix in-house and $100 once it fails
            in the field.
          </strong>{" "}
          External failures (the ones customers see) are usually 4-10× more expensive than internal
          ones — so &ldquo;ship faster, fix later&rdquo; rarely pencils out. Cost time as hours × a
          blended hourly rate, and log each quarter to watch the failure share move.
        </CalloutAlert>
      </div>
    </ToolPageWrapper>
  );
}

/** The in-place editor under the table, focused when it opens. */
function EditPanel({ title, children }: { title: string; children: ReactNode }) {
  const ref = useFocusFirst<HTMLDivElement>();
  return (
    <div ref={ref} className="rounded-lg border border-accent/40 bg-card p-3 sm:p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">{title}</h3>
      {children}
    </div>
  );
}

/**
 * The blended hourly rate behind "hours × rate", stored once; unset until
 * typed (never a default). Saved when the field is left; blank clears it.
 */
function RateField({
  rate,
  onCommit,
}: {
  rate: number | undefined;
  onCommit: (rate: number | undefined) => void;
}) {
  const committed = rate === undefined ? "" : String(rate);
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(committed);
    setError(null);
  }, [committed]);

  const commit = () => {
    if (draft.trim() === committed) return setError(null);
    const n = parseNumber(draft.replace(/[$,\s]/g, ""));
    if (n === undefined) {
      setError(null);
      onCommit(undefined);
      return;
    }
    if (!Number.isFinite(n) || n < 0) return setError("Enter a rate of 0 or more.");
    setError(null);
    onCommit(Math.round(n * 100) / 100);
  };

  return (
    <Field
      label="Blended hourly rate (optional)"
      hint="What an hour of the team's time costs. Needed for “Hours × rate”."
      error={error ?? undefined}
      className="sm:max-w-xs"
    >
      {(props) => (
        <div className="relative">
          <span
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-sub"
            aria-hidden="true"
          >
            $
          </span>
          <Input
            {...props}
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            className="pl-6 font-data"
          />
        </div>
      )}
    </Field>
  );
}

/**
 * The figures saved before the page kept quarters. They belong to no
 * quarter until the person picks one: "Save as a period" never assumes the
 * current quarter.
 */
function LegacyNotice({
  costs,
  description,
  periods,
  onSave,
  onDiscard,
}: {
  costs: CostFigures;
  description: string | undefined;
  periods: readonly QualityCostPeriod[];
  onSave: (period: string) => void;
  onDiscard: () => void;
}) {
  const [period, setPeriod] = useState("");
  const [tried, setTried] = useState(false);
  const errors = costPeriodErrors({ period, costs }, periods);
  const error = tried ? errors.period : undefined;
  return (
    <section
      aria-labelledby="coq-legacy-heading"
      className="rounded-lg border border-info/30 bg-info/10 p-4 text-sm text-text"
    >
      <h2 id="coq-legacy-heading" className="font-medium">
        Figures from before quarters
      </h2>
      <p className="mt-1 text-sub">
        {COST_CATEGORIES.map((c) => `${COST_CATEGORY_LABEL[c]} ${amountText(costs, c)}`).join(
          " · "
        )}
        {description?.trim() ? ` — “${description.trim()}”` : ""}. Pick the quarter they cover to
        add them to the history.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <QuarterPicker
          label="Quarter these figures cover"
          format="dash"
          value={period}
          onChange={setPeriod}
          also={periods.map((p) => p.period)}
          marked={new Set(periods.map((p) => p.period))}
          latest={currentQuarter()}
          yearsBack={5}
          currentLabel="in progress"
          error={error}
          required
          className="w-full sm:w-64"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setTried(true);
            const quarter = typedCostQuarter(period);
            if (!errors.period && quarter) onSave(quarter);
          }}
        >
          Save as a period
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
          Discard them
        </Button>
      </div>
    </section>
  );
}
