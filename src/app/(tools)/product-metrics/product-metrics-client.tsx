"use client";

/**
 * Product Metrics: the numbers a product lives by. A North Star with the
 * few inputs that move it, HEART goals for each feature, an AARRR funnel,
 * and every metric with its readings, typed or pasted from the team's own
 * analytics. The metrics are workspace rows (`productMetrics`), shared
 * with the EBM Dashboard (whose measures show here with an "EBM" chip),
 * Amr (`tool.product_metrics.*`) and the next steps.
 *
 * Every write checks the views' rules first (`metricRuleProblems`: one
 * North Star, five inputs, one metric per stage and per HEART feature and
 * category, 60 in all) and says inline why it can't. Deletes, the funnel
 * period, "Set as North Star" and accepted suggestions come with Undo.
 * The example's rows are `example-pm-` and only its own "Clear example"
 * removes them; history is logged for the team's own rows only.
 */

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Gauge } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { WallViewButton } from "@/components/presentation/wall-view";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  AARRR_STAGES,
  ENTITY_ROW_MAX_BYTES,
  type AarrrStage,
  type MetricReading,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PRODUCT_METRICS_ACTIONS } from "@/lib/history/event-actions";
import { cheer } from "@/lib/celebrate/cheer";
import { undoable } from "@/lib/utils/undoable";
import { isExampleId } from "@/lib/utils/example-id";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { todayIso } from "@/lib/sprints/series";
import { productGoalLine } from "@/lib/product-goal/model";
import { formatMetric } from "@/lib/hypotheses/model";
import { generateProductMetricsPrompts } from "@/lib/ai-prompts/product-metrics";
import { metricTemplates } from "@/lib/product-metrics/templates";
import { SOURCE_INFO } from "@/lib/ebm/source-info";
import {
  AARRR_LABEL,
  EMPTY_METRIC_DRAFT,
  READINGS_MAX,
  READING_ID_PREFIX,
  READING_TOO_OLD,
  emptyFunnelDraft,
  funnelView,
  heartView,
  isEbmExample,
  isMetricsExample,
  latestText,
  metricDraftFor,
  metricFromValues,
  metricLinks,
  metricRuleProblems,
  northStarView,
  northStarWrites,
  readingsLeftOutText,
  stageMetrics,
  usableMetrics,
  validateFunnelPeriod,
  withReading,
  withReadings,
  withoutReading,
  type FunnelDraft,
  type FunnelField,
  type FunnelValues,
  type MetricDraft,
  type MetricValues,
  type ReadingValues,
} from "@/lib/product-metrics/model";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { MetricForm } from "./metric-form";
import { ReadingPanel } from "./reading-panel";
import { SuggestPanel } from "./suggest-panel";
import {
  AllMetricsPanel,
  FunnelPanel,
  HeartPanel,
  NorthStarPanel,
  type MetricActions,
} from "./views";

export const TOOL_ID = "product-metrics";

type Mode = "north-star" | "heart" | "aarrr" | "all";

const MODES: { value: Mode; label: string }[] = [
  { value: "north-star", label: "North Star" },
  { value: "heart", label: "HEART" },
  { value: "aarrr", label: "AARRR funnel" },
  { value: "all", label: "All metrics" },
];

const NO_METRICS: ProductMetric[] = [];

const store = () => useWorkspaceStore.getState();
const current = () => store().productMetrics ?? [];
const put = (rows: readonly ProductMetric[]) => {
  for (const r of rows) store().upsertProductMetric(r);
};
const replaceIn = (list: readonly ProductMetric[], row: ProductMetric) =>
  list.some((m) => m.id === row.id) ? list.map((m) => (m.id === row.id ? row : m)) : [...list, row];

const TOO_BIG = "This metric is too big to save. Shorten or remove some lines. Nothing was saved.";

/** Why `rows` can't be written in this order, or null. */
function writeProblem(rows: readonly ProductMetric[]): string | null {
  let all: readonly ProductMetric[] = current();
  for (const r of rows) {
    const problems = metricRuleProblems(r, all);
    if (problems.length > 0) return problems.join(" ");
    if (jsonBytes(r) > ENTITY_ROW_MAX_BYTES) return TOO_BIG;
    all = replaceIn(all, r);
  }
  return null;
}

const newMetricId = (example = false) => `${example ? "example-pm-" : ""}metric_${nanoid(8)}`;

/** Each funnel stage's metric among the team's own rows only. */
const teamStages = (rows: readonly ProductMetric[]) =>
  stageMetrics(usableMetrics(rows, { withExamples: false }));

type Editing = { kind: "new"; draft: MetricDraft } | { kind: "edit"; id: string } | null;

export function ProductMetricsClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.productMetrics) ?? NO_METRICS;
  const goals = useWorkspaceStore((s) => s.productGoals);
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers);
  const abTests = useWorkspaceStore((s) => s.abTests);
  const { log } = useHistoryLogger(TOOL_ID);
  const [mode, setMode] = useState<Mode>("north-star");
  const [editing, setEditing] = useState<Editing>(null);
  const [readingFor, setReadingFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");
  const [today] = useState(() => todayIso());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const metrics = useMemo(() => usableMetrics(stored), [stored]);
  const productGoal = productGoalLine(goals);
  const hasExample = metrics.some((m) => isMetricsExample(m.id));
  // The EBM example's measures are EBM's: with only those, this page is still
  // empty and offers its own example (as the EBM page ignores rows it doesn't use).
  const pageRows = metrics.filter((m) => !isEbmExample(m.id));
  const { northStar, inputs } = northStarView(metrics);
  const heart = heartView(metrics);
  const funnel = funnelView(metrics);
  // The funnel shows the example's stages while the team has none, but a
  // period and the set-up only ever write the team's own (as add_funnel_period).
  const byStage = teamStages(metrics);
  const missingStages = AARRR_STAGES.filter((s) => !byStage[s]).length;
  const exampleFunnel = funnel.stages.some((s) => s.metric !== null && isExampleId(s.metric.id));
  const hypotheses = useMemo(
    () => (trackers ?? []).flatMap((t) => (Array.isArray(t?.hypotheses) ? t.hypotheses : [])),
    [trackers]
  );

  /** History for the team's own rows; the example's edits aren't the team's work. */
  const record = (action: string, metricId: string, payload: Record<string, unknown> = {}) => {
    if (!isExampleId(metricId)) log(action, { metricId, ...payload });
  };

  const done = (message: string) => {
    setStatus(message);
    setProblem("");
  };
  const refuse = (message: string) => {
    setProblem(message);
    setStatus("");
  };

  /* ── Writes ─────────────────────────────────────────────────────── */

  const saveMetric = (values: MetricValues) => {
    const now = new Date().toISOString();
    if (editing?.kind === "edit") {
      const base = current().find((m) => m.id === editing.id);
      if (!base) return;
      const row = metricFromValues(values, { id: base.id, now, base });
      const why = writeProblem([row]);
      if (why) return refuse(why);
      put([row]);
      record(PRODUCT_METRICS_ACTIONS.METRIC_UPDATED, row.id);
      setEditing(null);
      done(`Saved “${row.name}”.`);
      return;
    }
    const row = metricFromValues(values, { id: newMetricId(), now });
    const why = writeProblem([row]);
    if (why) return refuse(why);
    put([row]);
    record(PRODUCT_METRICS_ACTIONS.METRIC_ADDED, row.id, {
      ...(row.role ? { role: row.role } : {}),
      ...(row.heart ? { heart: row.heart.category } : {}),
      ...(row.aarrr ? { stage: row.aarrr } : {}),
    });
    setEditing(null);
    setReadingFor(row.id);
    done(`Added “${row.name}”. Add its first reading.`);
  };

  /** New rows (suggestions, the funnel set-up), one Undo for all; rows that break a rule are left out. */
  const createRows = (rows: ProductMetric[], label: string): number => {
    let all: readonly ProductMetric[] = current();
    const ok: ProductMetric[] = [];
    for (const r of rows) {
      if (metricRuleProblems(r, all).length > 0 || jsonBytes(r) > ENTITY_ROW_MAX_BYTES) continue;
      ok.push(r);
      all = replaceIn(all, r);
    }
    if (ok.length === 0) return 0;
    undoable({
      label,
      apply: () => put(ok),
      revert: () => ok.forEach((r) => store().removeProductMetric(r.id)),
    });
    for (const r of ok) record(PRODUCT_METRICS_ACTIONS.METRIC_ADDED, r.id);
    return ok.length;
  };

  const addReading = (metric: ProductMetric, values: ReadingValues) => {
    const base = current().find((m) => m.id === metric.id);
    if (!base) return;
    const {
      metric: next,
      replaced,
      kept,
    } = withReading(
      base,
      { id: `${READING_ID_PREFIX}${nanoid(8)}`, ...values },
      new Date().toISOString()
    );
    if (!kept) return refuse(READING_TOO_OLD);
    if (jsonBytes(next) > ENTITY_ROW_MAX_BYTES) return refuse(TOO_BIG);
    put([next]);
    record(PRODUCT_METRICS_ACTIONS.READING_ADDED, next.id, { date: values.date });
    done(
      `${replaced ? "Replaced" : "Added"} the reading of ${values.date}: ${formatMetric(values.value, next.unit)}.`
    );
  };

  const importReadings = (metric: ProductMetric, readings: ReadingValues[]) => {
    const before = current().find((m) => m.id === metric.id);
    if (!before) return;
    const {
      metric: next,
      kept,
      left,
    } = withReadings(
      before,
      readings.map((r) => ({ id: `${READING_ID_PREFIX}${nanoid(8)}`, ...r })),
      new Date().toISOString()
    );
    if (kept === 0) return refuse(READING_TOO_OLD);
    if (jsonBytes(next) > ENTITY_ROW_MAX_BYTES) return refuse(TOO_BIG);
    undoable({
      label: `Added ${kept} ${kept === 1 ? "reading" : "readings"} to “${metric.name}”`,
      apply: () => put([next]),
      revert: () => put([before]),
    });
    record(PRODUCT_METRICS_ACTIONS.READINGS_IMPORTED, metric.id, { readings: kept, metrics: 1 });
    done(`Added ${kept} ${kept === 1 ? "reading" : "readings"}.`);
    if (left > 0) setProblem(readingsLeftOutText(left));
  };

  const removeReading = (metric: ProductMetric, reading: MetricReading) => {
    const before = current().find((m) => m.id === metric.id);
    if (!before) return;
    undoable({
      label: `Removed the reading of ${reading.date}`,
      apply: () => put([withoutReading(before, reading.id, new Date().toISOString())]),
      revert: () => put([before]),
    });
    record(PRODUCT_METRICS_ACTIONS.READING_REMOVED, metric.id, { date: reading.date });
  };

  const setNorthStar = (metric: ProductMetric) => {
    const all = current();
    const writes = northStarWrites(all, metric.id, new Date().toISOString());
    if (writes.length === 0) return;
    const why = writeProblem(writes);
    if (why) return refuse(why);
    const before = writes
      .map((w) => all.find((m) => m.id === w.id))
      .filter(Boolean) as ProductMetric[];
    undoable({
      label: `“${metric.name}” is the North Star`,
      apply: () => put(writes),
      // The new North Star loses its role first, so the old one can take it back.
      revert: () => put([...before].reverse()),
    });
    record(PRODUCT_METRICS_ACTIONS.NORTH_STAR_SET, metric.id);
    if (!isExampleId(metric.id)) cheer(TOOL_ID, "milestone");
    done(`“${metric.name}” is now the North Star.`);
  };

  const deleteMetric = (metric: ProductMetric) => {
    const before = current().find((m) => m.id === metric.id) ?? metric;
    undoable({
      label: `Deleted “${metric.name}”`,
      apply: () => store().removeProductMetric(metric.id),
      revert: () => put([before]),
    });
    record(PRODUCT_METRICS_ACTIONS.METRIC_REMOVED, metric.id);
    setDeleting(null);
    if (readingFor === metric.id) setReadingFor(null);
    done("");
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const askDelete = (metric: ProductMetric) => {
    const links = metricLinks(metric.id, hypotheses, abTests ?? []);
    if (metric.kva || links.hypotheses > 0 || links.abTests > 0) setDeleting(metric.id);
    else deleteMetric(metric);
  };

  const addFunnelPeriod = (values: FunnelValues) => {
    // Only the team's own stage metrics take a period: never the example's.
    const own = teamStages(current());
    const now = new Date().toISOString();
    const stages = AARRR_STAGES.filter((s) => values.counts[s] !== undefined);
    if (stages.some((s) => !own[s])) {
      return refuse("A stage counted here has no metric of your own yet: set up the funnel first.");
    }
    const before = stages.map((s) => own[s] as ProductMetric);
    const results = stages.map((s) =>
      withReading(
        own[s] as ProductMetric,
        {
          id: `${READING_ID_PREFIX}${nanoid(8)}`,
          date: values.date,
          value: values.counts[s] as number,
        },
        now
      )
    );
    const dropped = stages.find((_, i) => !results[i].kept);
    if (dropped) {
      return refuse(
        `Only the newest ${READINGS_MAX} readings are kept, and this period is older than all of ${AARRR_LABEL[dropped]}'s. Nothing was saved.`
      );
    }
    const writes = results.map((r) => r.metric);
    undoable({
      label: `Added the funnel period of ${values.date}`,
      apply: () => put(writes),
      revert: () => put(before),
    });
    log(PRODUCT_METRICS_ACTIONS.FUNNEL_PERIOD_ADDED, { date: values.date, stages: stages.length });
    done(`Added the period of ${values.date}.`);
  };

  const setUpFunnel = () => {
    const now = new Date().toISOString();
    const templates = metricTemplates({ framework: "aarrr", existing: [] });
    const own = teamStages(current());
    const rows = AARRR_STAGES.filter((s) => !own[s]).map((stage) => {
      const t = templates.find((x) => x.aarrrStage === stage);
      return metricFromValues(
        {
          name: t?.name ?? AARRR_LABEL[stage],
          ...(t?.definition ? { definition: t.definition } : {}),
          unit: t?.unit ?? "people",
          direction: "increase",
          aarrr: stage,
        },
        { id: newMetricId(), now }
      );
    });
    const n = createRows(
      rows,
      `Set up ${rows.length} funnel ${rows.length === 1 ? "stage" : "stages"}`
    );
    done(n > 0 ? `Added ${n} stage ${n === 1 ? "metric" : "metrics"}. Add a period's counts.` : "");
  };

  /* ── Example ────────────────────────────────────────────────────── */

  const loadExample = () => {
    put(buildExample(today, new Date().toISOString()));
    done("The example is loaded.");
  };
  const clearExample = () => {
    for (const m of current()) if (isMetricsExample(m.id)) store().removeProductMetric(m.id);
    setReadingFor(null);
    setEditing(null);
    done("The example is cleared.");
  };

  /* ── View ───────────────────────────────────────────────────────── */

  const actions: MetricActions = {
    onReading: (m) => {
      setEditing(null);
      setReadingFor(m.id);
    },
    onEdit: (m) => {
      setReadingFor(null);
      setEditing({ kind: "edit", id: m.id });
    },
    onSetNorthStar: setNorthStar,
    onDelete: askDelete,
  };
  const startNew = (patch: Partial<MetricDraft> = {}) => {
    setReadingFor(null);
    setEditing({ kind: "new", draft: { ...EMPTY_METRIC_DRAFT, ...patch } });
  };

  const markdown = useMemo(() => toMarkdown({ metrics, productGoal }), [metrics, productGoal]);
  const promptConfig = useMemo(
    () => ({
      toolName: "Product Metrics",
      prompts: generateProductMetricsPrompts({
        productGoal: productGoal ?? "",
        northStar: northStar?.name ?? "",
        inputs: inputs.map((m) => m.name),
        metrics: metrics.slice(0, 30).map((m) => `${m.name}: ${latestText(m)}`),
        funnel: funnel.date
          ? funnel.stages.map((s) => `${AARRR_LABEL[s.stage]} ${s.count ?? "—"}`).join(", ")
          : "",
      }),
    }),
    [productGoal, northStar, inputs, metrics, funnel]
  );

  const readingMetric = readingFor ? metrics.find((m) => m.id === readingFor) : undefined;
  const editingMetric =
    editing?.kind === "edit" ? metrics.find((m) => m.id === editing.id) : undefined;
  const deletingMetric = deleting ? metrics.find((m) => m.id === deleting) : undefined;

  const content = !hydrated ? (
    <WorkspaceLoading>Loading your metrics…</WorkspaceLoading>
  ) : (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {hasExample && <ExampleNotice onClear={clearExample} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-lg font-semibold text-text focus:outline-none"
        >
          Product metrics
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {northStar && (
            <WallViewButton title="North Star">
              {() => (
                <NorthStarPanel
                  northStar={northStar}
                  inputs={inputs}
                  productGoal={productGoal}
                  readOnly
                />
              )}
            </WallViewButton>
          )}
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="product-metrics"
            markdown={markdown}
            clipboardText={markdown}
            jsonData={{ metrics }}
          />
        </div>
      </div>
      <p className="text-xs text-sub">
        The numbers come from your own analytics: type them or paste them. Nothing is read from
        another service.
      </p>
      {problem && (
        <p className="text-sm text-danger" role="alert">
          {problem}
        </p>
      )}

      {pageRows.length === 0 && !editing ? (
        <EmptyState
          icon={Gauge}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => startNew({ role: "north-star" })}>
                Add the North Star
              </Button>
              <LoadExampleButton onLoad={loadExample} />
            </div>
          }
        >
          <p className="text-sm">
            No metrics yet. Start with the North Star, the one number that counts the value people
            get, or look at an example first.
          </p>
        </EmptyState>
      ) : (
        <>
          <ToggleGroup label="View" options={MODES} value={mode} onValueChange={setMode} />

          {editing && (
            <SectionCard title={editingMetric ? `Edit “${editingMetric.name}”` : "A new metric"}>
              <MetricForm
                key={editing.kind === "edit" ? editing.id : "new"}
                initial={
                  editingMetric
                    ? metricDraftFor(editingMetric)
                    : editing.kind === "new"
                      ? editing.draft
                      : EMPTY_METRIC_DRAFT
                }
                id={editingMetric?.id ?? "metric_new"}
                all={current()}
                directionLockedBy={
                  editingMetric?.source ? SOURCE_INFO[editingMetric.source]?.label : undefined
                }
                submitLabel={editingMetric ? "Save the metric" : "Add the metric"}
                onSave={saveMetric}
                onCancel={() => setEditing(null)}
              />
            </SectionCard>
          )}

          {readingMetric && (
            <ReadingPanel
              key={readingMetric.id}
              metric={readingMetric}
              today={today}
              onAdd={(v) => addReading(readingMetric, v)}
              onImport={(rs) => importReadings(readingMetric, rs)}
              onRemove={(r) => removeReading(readingMetric, r)}
              onClose={() => setReadingFor(null)}
            />
          )}

          {deletingMetric && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm"
            >
              <p>
                “{deletingMetric.name}” is linked elsewhere
                {deletingMetric.kva ? ": it is an EBM measure" : ""}
                {(() => {
                  const l = metricLinks(deletingMetric.id, hypotheses, abTests ?? []);
                  const parts = [
                    l.hypotheses > 0
                      ? `${l.hypotheses} ${l.hypotheses === 1 ? "hypothesis is" : "hypotheses are"} measured by it`
                      : "",
                    l.abTests > 0
                      ? `${l.abTests} A/B ${l.abTests === 1 ? "test moves" : "tests move"} it`
                      : "",
                  ].filter(Boolean);
                  return parts.length > 0
                    ? `${deletingMetric.kva ? ", and " : ": "}${parts.join(" and ")}`
                    : "";
                })()}
                . Those links will read “metric removed”; Undo brings them back.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => deleteMetric(deletingMetric)}
                >
                  Delete it
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                  Keep it
                </Button>
              </div>
            </div>
          )}

          {mode === "north-star" && (
            <NorthStarPanel
              northStar={northStar}
              inputs={inputs}
              productGoal={productGoal}
              actions={actions}
              onNew={(role) => startNew({ role })}
            />
          )}
          {mode === "heart" && (
            <HeartPanel
              features={heart}
              actions={actions}
              onNew={({ category, feature }) =>
                startNew({ heartCategory: category, heartFeature: feature })
              }
            />
          )}
          {mode === "aarrr" && (
            <FunnelPanel
              funnel={funnel}
              missingStages={missingStages}
              example={exampleFunnel}
              onSetUp={setUpFunnel}
              periodForm={
                missingStages < 5 ? (
                  <FunnelPeriodForm
                    today={today}
                    hasMetric={
                      Object.fromEntries(
                        AARRR_STAGES.map((s) => [s, Boolean(byStage[s])])
                      ) as Record<AarrrStage, boolean>
                    }
                    onSave={addFunnelPeriod}
                  />
                ) : null
              }
            />
          )}
          {mode === "all" && (
            <AllMetricsPanel metrics={metrics} actions={actions} onNew={() => startNew()} />
          )}

          {mode !== "all" && (
            <SuggestPanel
              framework={mode}
              metrics={metrics}
              productGoal={productGoal}
              newId={() => newMetricId()}
              onAdd={(rows) =>
                createRows(
                  rows,
                  `Added ${rows.length === 1 ? `“${rows[0].name}”` : `${rows.length} metrics`}`
                )
              }
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <ToolPageWrapper
      toolId="product-metrics"
      title="Product Metrics"
      description="A North Star and its inputs, HEART goals and an AARRR funnel."
    >
      {content}
    </ToolPageWrapper>
  );
}

/** "Add a period": one day's counts, one reading on each stage's metric. */
function FunnelPeriodForm({
  today,
  hasMetric,
  onSave,
}: {
  today: string;
  hasMetric: Record<AarrrStage, boolean>;
  onSave: (values: FunnelValues) => void;
}) {
  const form = useItemForm<FunnelDraft, FunnelValues, FunnelField>({
    initial: () => emptyFunnelDraft(today),
    validate: (d) => validateFunnelPeriod(d, today, hasMetric),
    onSave,
  });
  const { draft, update, errors } = form;
  return (
    <section aria-label="Add a period" className="rounded-lg border border-border p-3">
      <h3 className="mb-2 text-sm font-medium text-text">Add a period</h3>
      <ItemForm form={form} submitLabel="Add the period">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Day" error={errors.date} required className="col-span-2 md:col-span-1">
            {(props) => (
              <Input
                {...props}
                type="date"
                max={today}
                value={draft.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            )}
          </Field>
          {AARRR_STAGES.map((s) => (
            <Field key={s} label={AARRR_LABEL[s]} error={errors[s]} required={s === "acquisition"}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  value={draft[s]}
                  onChange={(e) => update({ [s]: e.target.value } as Partial<FunnelDraft>)}
                />
              )}
            </Field>
          ))}
        </div>
      </ItemForm>
    </section>
  );
}
