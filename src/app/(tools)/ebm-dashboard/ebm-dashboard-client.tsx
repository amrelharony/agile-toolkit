"use client";

/**
 * The EBM Dashboard: Evidence-Based Management's four key value areas,
 * each with a few measures, tied to a goal ladder (the strategic goal, the
 * Product Goal, the sprint's goal) and the experiments in the Hypothesis
 * Tracker that move them, with quarterly reviews.
 *
 * The measures are workspace product metrics with `kva` set, so they also
 * show in Product Metrics; the goal and the reviews are the one
 * `EbmBoard`. Readings are typed, pasted, or taken from the toolkit's own
 * data (cycle time, DORA, NPS, tech debt) only when the person presses
 * "Add this reading". "Area progress" is our own simplification: EBM gives
 * no score. The example's rows are `example-ebm-`; only this page's "Clear
 * example" removes them. History is logged for the team's own rows only.
 */

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { Radar } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { WallViewButton } from "@/components/presentation/wall-view";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  EBM_VALUE_AREAS,
  ENTITY_ROW_MAX_BYTES,
  METRIC_SOURCE_IDS,
  type EbmBoard,
  type EbmValueArea,
  type MetricDirection,
  type MetricReading,
  type MetricSourceId,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { EBM_DASHBOARD_ACTIONS } from "@/lib/history/event-actions";
import { cheer } from "@/lib/celebrate/cheer";
import { undoable } from "@/lib/utils/undoable";
import { isExampleId } from "@/lib/utils/example-id";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { todayIso } from "@/lib/sprints/series";
import { formatMetric } from "@/lib/hypotheses/model";
import { generateEbmDashboardPrompts } from "@/lib/ai-prompts/ebm-dashboard";
import { MEASURES_PRODUCT_MAX } from "@/lib/ai/tasks/ebm-dashboard.lite";
import {
  READING_ID_PREFIX,
  READING_TOO_OLD,
  compactMetric,
  isEbmExample,
  latestText,
  metricDraftFor,
  metricFromValues,
  metricLinks,
  metricRuleProblems,
  readingsLeftOutText,
  usableMetrics,
  withReading,
  withReadings,
  withoutReading,
  type MetricValues,
  type ReadingValues,
} from "@/lib/product-metrics/model";
import {
  AREA_LABEL,
  EBM_CREDIT,
  EBM_CREDIT_HREF,
  REVIEW_ID_PREFIX,
  REVIEW_TOO_OLD,
  areaScores,
  ebmExampleLoaded,
  ebmVerdict,
  emptyEbmBoard,
  experimentsFor,
  goalLadder,
  holdsReview,
  hypothesesOf,
  measuresByArea,
  newReview,
  readBoard,
  reviewPool,
  reviewsNewestFirst,
  ruleReview,
  scoreText,
  sourceProblem,
  withReview,
  withStrategicGoal,
  type ReviewValues,
} from "@/lib/ebm/model";
import { SOURCE_INFO, readSource, type SourceReading } from "@/lib/ebm/sources";
import { ideaNamed } from "@/lib/ebm/ideas";
import { MetricForm } from "@/app/(tools)/product-metrics/metric-form";
import { ReadingPanel } from "@/app/(tools)/product-metrics/reading-panel";
import { AreaPanel } from "./area-panel";
import { EbmRadar } from "./radar";
import { LadderCard } from "./ladder";
import { ReviewPanel } from "./reviews";
import { EXAMPLE_STRATEGIC_GOAL, EXAMPLE_STRATEGIC_WHY, buildEbmExample } from "./example";
import { toMarkdown } from "./markdown";

export const TOOL_ID = "ebm-dashboard";

const NO_METRICS: ProductMetric[] = [];

const store = () => useWorkspaceStore.getState();
const currentMetrics = () => store().productMetrics ?? [];
const currentBoard = () => readBoard(store().ebmBoards);
const putMetrics = (rows: readonly ProductMetric[]) => {
  for (const r of rows) store().upsertProductMetric(r);
};
const TOO_BIG = "This is too big to save. Shorten or remove some lines. Nothing was saved.";

const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A measure idea or an accepted suggestion. */
interface IdeaLike {
  name: string;
  definition?: string;
  unit?: string;
  direction: MetricDirection;
  source?: MetricSourceId;
}

export function EbmDashboardClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.productMetrics) ?? NO_METRICS;
  const boards = useWorkspaceStore((s) => s.ebmBoards);
  const goals = useWorkspaceStore((s) => s.productGoals);
  const sprints = useWorkspaceStore((s) => s.sprints);
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers);
  const abTests = useWorkspaceStore((s) => s.abTests);
  const stories = useWorkspaceStore((s) => s.stories);
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const dora = useWorkspaceStore((s) => s.doraScorecards);
  const nps = useWorkspaceStore((s) => s.npsResponses);
  const techDebt = useWorkspaceStore((s) => s.techDebt);
  const { log } = useHistoryLogger(TOOL_ID);
  const [today] = useState(() => todayIso());
  const [product, setProduct] = useState("");
  const [readingFor, setReadingFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");

  const metrics = useMemo(() => usableMetrics(stored), [stored]);
  const board = useMemo(() => readBoard(boards), [boards]);
  const byArea = useMemo(() => measuresByArea(metrics), [metrics]);
  const scores = areaScores(byArea);
  const ladder = goalLadder({ board, goals, sprints });
  const hypotheses = useMemo(() => hypothesesOf(trackers), [trackers]);
  const readings = useMemo(() => {
    const data = { stories, boards: kanbanBoards, dora, nps, techDebt };
    const out: Partial<Record<MetricSourceId, SourceReading | null>> = {};
    for (const id of METRIC_SOURCE_IDS) out[id] = readSource(id, data, today);
    return out;
  }, [stories, kanbanBoards, dora, nps, techDebt, today]);
  const exampleLoaded = ebmExampleLoaded(metrics, board);
  const reviews = reviewsNewestFirst(board);
  const verdict = ebmVerdict(byArea, board, today);
  // A strategic goal alone still offers the example (it keeps the team's goal).
  const anything = EBM_VALUE_AREAS.some((a) => byArea[a].length > 0) || reviews.length > 0;

  const record = (action: string, id: string, payload: Record<string, unknown> = {}) => {
    if (!isExampleId(id)) log(action, payload);
  };
  const done = (message: string) => {
    setStatus(message);
    setProblem("");
  };

  /* ── Measures ───────────────────────────────────────────────────── */

  /** Why `row` can't be written beside `all` (the stored rows by default), or null. */
  const writeProblem = (
    row: ProductMetric,
    all: readonly ProductMetric[] = currentMetrics()
  ): string | null => {
    const problems = metricRuleProblems(row, all);
    const source = row.source && row.kva ? sourceProblem(row.kva, row.source, row.direction) : null;
    if (source) problems.push(source);
    if (problems.length > 0) return problems.join(" ");
    return jsonBytes(row) > ENTITY_ROW_MAX_BYTES ? TOO_BIG : null;
  };

  const addMeasure = (area: EbmValueArea, values: MetricValues, source?: MetricSourceId) => {
    const row = metricFromValues(values, {
      id: `metric_${nanoid(8)}`,
      now: new Date().toISOString(),
      extra: { kva: area, ...(source ? { source } : {}), readings: [] },
    });
    const why = writeProblem(row);
    if (why) return why;
    putMetrics([row]);
    record(EBM_DASHBOARD_ACTIONS.MEASURE_ADDED, row.id, {
      metricId: row.id,
      area,
      ...(source ? { source } : {}),
    });
    setReadingFor(row.id);
    done(`Added “${row.name}” to ${AREA_LABEL[area]}. Add its first reading.`);
    return null;
  };

  const addIdeas = (area: EbmValueArea, ideas: readonly IdeaLike[]) => {
    const now = new Date().toISOString();
    const taken = new Set(byArea[area].map((m) => nameKey(m.name)));
    const candidates = ideas
      .filter((i) => !taken.has(nameKey(i.name)))
      .map((i) => {
        // A suggestion (with or without AI) that is one of our ideas keeps
        // the idea's toolkit source, so it can still take its readings.
        const idea = i.source ? undefined : ideaNamed(area, i.name);
        const source = i.source ?? idea?.source;
        const info = source ? SOURCE_INFO[source] : undefined;
        return compactMetric({
          id: `metric_${nanoid(8)}`,
          name: i.name,
          definition: i.definition || undefined,
          unit: i.unit || idea?.unit || info?.unit || undefined,
          direction: info?.direction ?? i.direction,
          kva: area,
          source,
          readings: [],
          createdAt: now,
          updatedAt: now,
        });
      });
    // Each row is checked beside the ones before it, so "Add all" keeps the 60-metric cap.
    let all: readonly ProductMetric[] = currentMetrics();
    const rows: ProductMetric[] = [];
    for (const r of candidates) {
      if (writeProblem(r, all) !== null) continue;
      rows.push(r);
      all = [...all, r];
    }
    if (rows.length === 0) return 0;
    undoable({
      label: rows.length === 1 ? `Added “${rows[0].name}”` : `Added ${rows.length} measures`,
      apply: () => putMetrics(rows),
      revert: () => rows.forEach((r) => store().removeProductMetric(r.id)),
    });
    for (const r of rows) {
      record(EBM_DASHBOARD_ACTIONS.MEASURE_ADDED, r.id, {
        metricId: r.id,
        area,
        ...(r.source ? { source: r.source } : {}),
      });
    }
    done(
      `Added ${rows.length} ${rows.length === 1 ? "measure" : "measures"} to ${AREA_LABEL[area]}.`
    );
    return rows.length;
  };

  const storedRow = (m: ProductMetric) => currentMetrics().find((x) => x.id === m.id) ?? m;
  const sitsElsewhere = (m: ProductMetric) => Boolean(m.role || m.heart || m.aarrr);

  /**
   * What deleting `m` would break, as Product Metrics says it: null when it
   * only leaves EBM (it sits in another view) or nothing links to it.
   */
  const removeWarning = (m: ProductMetric): string | null => {
    const before = storedRow(m);
    if (sitsElsewhere(before)) return null;
    const l = metricLinks(m.id, hypotheses, abTests ?? []);
    const parts = [
      l.hypotheses > 0
        ? `${l.hypotheses} ${l.hypotheses === 1 ? "hypothesis is" : "hypotheses are"} measured by it`
        : "",
      l.abTests > 0 ? `${l.abTests} A/B ${l.abTests === 1 ? "test moves" : "tests move"} it` : "",
    ].filter(Boolean);
    if (parts.length === 0) return null;
    return `“${m.name}” is linked elsewhere: ${parts.join(" and ")}. Those links will read “metric removed”; Undo brings them back.`;
  };

  /** A measure that also sits in another view keeps its row and loses only its area; else it goes. */
  const removeMeasure = (m: ProductMetric) => {
    const before = storedRow(m);
    const keep = sitsElsewhere(before);
    undoable({
      label: keep ? `Removed “${m.name}” from EBM` : `Deleted “${m.name}”`,
      apply: () =>
        keep
          ? putMetrics([
              compactMetric({ ...before, kva: undefined, updatedAt: new Date().toISOString() }),
            ])
          : store().removeProductMetric(m.id),
      revert: () => putMetrics([before]),
    });
    record(EBM_DASHBOARD_ACTIONS.MEASURE_REMOVED, m.id, { metricId: m.id });
    if (readingFor === m.id) setReadingFor(null);
    if (editingId === m.id) setEditingId(null);
    done("");
  };

  const saveEdit = (values: MetricValues) => {
    const base = currentMetrics().find((x) => x.id === editingId);
    if (!base) return;
    const row = metricFromValues(values, {
      id: base.id,
      now: new Date().toISOString(),
      base,
      // The form here holds no views: keep the ones the metric has.
      extra: {},
    });
    const merged = compactMetric({ ...row, role: base.role, heart: base.heart, aarrr: base.aarrr });
    const why = writeProblem(merged);
    if (why) return setProblem(why);
    putMetrics([merged]);
    record(EBM_DASHBOARD_ACTIONS.MEASURE_UPDATED, base.id, { metricId: base.id });
    setEditingId(null);
    done(`Saved “${merged.name}”.`);
  };

  const addReading = (m: ProductMetric, values: ReadingValues, source?: MetricSourceId) => {
    const base = currentMetrics().find((x) => x.id === m.id);
    if (!base) return;
    const { metric, replaced, kept } = withReading(
      base,
      { id: `${READING_ID_PREFIX}${nanoid(8)}`, ...values },
      new Date().toISOString()
    );
    if (!kept) return setProblem(READING_TOO_OLD);
    if (jsonBytes(metric) > ENTITY_ROW_MAX_BYTES) return setProblem(TOO_BIG);
    putMetrics([metric]);
    record(EBM_DASHBOARD_ACTIONS.READING_ADDED, m.id, {
      metricId: m.id,
      date: values.date,
      ...(source ? { source } : {}),
    });
    done(
      `${replaced ? "Replaced" : "Added"} the reading of ${values.date}: ${formatMetric(values.value, m.unit)}.`
    );
  };

  const importReadings = (m: ProductMetric, rs: ReadingValues[]) => {
    const before = currentMetrics().find((x) => x.id === m.id);
    if (!before) return;
    const {
      metric: next,
      kept,
      left,
    } = withReadings(
      before,
      rs.map((r) => ({ id: `${READING_ID_PREFIX}${nanoid(8)}`, ...r })),
      new Date().toISOString()
    );
    if (kept === 0) return setProblem(READING_TOO_OLD);
    if (jsonBytes(next) > ENTITY_ROW_MAX_BYTES) return setProblem(TOO_BIG);
    undoable({
      label: `Added ${kept} ${kept === 1 ? "reading" : "readings"} to “${m.name}”`,
      apply: () => putMetrics([next]),
      revert: () => putMetrics([before]),
    });
    record(EBM_DASHBOARD_ACTIONS.READING_ADDED, m.id, { metricId: m.id, readings: kept });
    done(`Added ${kept} ${kept === 1 ? "reading" : "readings"}.`);
    if (left > 0) setProblem(readingsLeftOutText(left));
  };

  const removeReading = (m: ProductMetric, r: MetricReading) => {
    const before = currentMetrics().find((x) => x.id === m.id);
    if (!before) return;
    undoable({
      label: `Removed the reading of ${r.date}`,
      apply: () => putMetrics([withoutReading(before, r.id, new Date().toISOString())]),
      revert: () => putMetrics([before]),
    });
  };

  /* ── The board ──────────────────────────────────────────────────── */

  const putBoard = (next: EbmBoard): boolean => {
    if (jsonBytes(next) > ENTITY_ROW_MAX_BYTES) {
      setProblem(TOO_BIG);
      return false;
    }
    store().upsertEbmBoard(next);
    return true;
  };

  const saveGoal = (values: { goal?: string; why?: string }) => {
    if (!putBoard(withStrategicGoal(currentBoard(), values, new Date().toISOString()))) return;
    log(EBM_DASHBOARD_ACTIONS.STRATEGIC_GOAL_SET, {
      goal: Boolean(values.goal),
      why: Boolean(values.why),
    });
    done(values.goal ? "The strategic goal is saved." : "The strategic goal is cleared.");
  };

  const recordReview = (values: ReviewValues) => {
    const pool = reviewPool(currentMetrics());
    const id = `${pool.exampleOnly ? "example-ebm-" : ""}${REVIEW_ID_PREFIX}${nanoid(8)}`;
    const review = newReview(id, values, pool.byArea);
    const next = withReview(currentBoard(), review, new Date().toISOString());
    if (!holdsReview(next, review.id)) return setProblem(REVIEW_TOO_OLD);
    if (!putBoard(next)) return;
    if (!pool.exampleOnly) {
      log(EBM_DASHBOARD_ACTIONS.REVIEW_RECORDED, {
        reviewId: review.id,
        focus: review.focus,
        measured: Object.keys(review.areas).length,
      });
      cheer(TOOL_ID, "milestone");
    }
    done(`Review recorded: focus on ${AREA_LABEL[review.focus]}.`);
  };

  /* ── Example ────────────────────────────────────────────────────── */

  const loadExample = () => {
    const now = new Date().toISOString();
    const ex = buildEbmExample(today, now);
    putMetrics(ex.metrics);
    let next = currentBoard() ?? emptyEbmBoard(now);
    if (!next.strategicGoal) {
      next = withStrategicGoal(
        next,
        { goal: EXAMPLE_STRATEGIC_GOAL, why: EXAMPLE_STRATEGIC_WHY },
        now
      );
    }
    for (const r of ex.reviews) next = withReview(next, r, now);
    store().upsertEbmBoard(next);
    done("The example is loaded.");
  };

  const clearExample = () => {
    for (const m of currentMetrics()) if (isEbmExample(m.id)) store().removeProductMetric(m.id);
    const b = currentBoard();
    if (b) {
      const now = new Date().toISOString();
      const own = b.strategicGoal === EXAMPLE_STRATEGIC_GOAL;
      store().upsertEbmBoard({
        ...(own ? withStrategicGoal(b, {}, now) : b),
        reviews: b.reviews.filter((r) => !isEbmExample(r.id)),
        updatedAt: now,
      });
    }
    setReadingFor(null);
    setEditingId(null);
    done("The example is cleared.");
  };

  /* ── View ───────────────────────────────────────────────────────── */

  const markdown = useMemo(
    () => toMarkdown({ ladder, byArea, board, hypotheses }),
    [ladder, byArea, board, hypotheses]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "EBM Dashboard",
      prompts: generateEbmDashboardPrompts({
        strategicGoal: ladder.strategic?.goal ?? "",
        productGoal: ladder.intermediate?.statement ?? "",
        sprintGoal: ladder.tactical?.goal ?? "",
        areas: EBM_VALUE_AREAS.map(
          (a) =>
            `${AREA_LABEL[a]} (${scoreText(scores[a])}): ${
              byArea[a].map((m) => `${m.name} ${latestText(m)}`).join("; ") || "no measures"
            }`
        ),
        lastReview: reviews[0]
          ? `${reviews[0].date}, focus on ${AREA_LABEL[reviews[0].focus]}${reviews[0].note ? `: ${reviews[0].note}` : ""}`
          : "",
      }),
    }),
    [ladder, scores, byArea, reviews]
  );
  const aiInput = {
    product: product.trim().slice(0, MEASURES_PRODUCT_MAX),
    ...(ladder.intermediate ? { productGoal: ladder.intermediate.statement.slice(0, 1000) } : {}),
    ...(ladder.strategic ? { strategicGoal: ladder.strategic.goal.slice(0, 1000) } : {}),
  };

  const readingMetric = readingFor ? metrics.find((m) => m.id === readingFor) : undefined;
  const editingMetric = editingId ? metrics.find((m) => m.id === editingId) : undefined;

  const content = !hydrated ? (
    <p className="text-sm text-sub" role="status">
      Loading your evidence…
    </p>
  ) : (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {exampleLoaded && <ExampleNotice onClear={clearExample} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-text">Evidence of value</h2>
          <p className="text-sm text-sub">{verdict}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WallViewButton title="EBM Dashboard">
            {() => (
              <div className="space-y-4">
                <EbmRadar scores={scores} />
                <ul className="grid grid-cols-2 gap-3 text-lg">
                  {EBM_VALUE_AREAS.map((a) => (
                    <li key={a}>
                      {AREA_LABEL[a]}: <span className="font-data">{scoreText(scores[a])}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </WallViewButton>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="ebm-dashboard"
            markdown={markdown}
            clipboardText={markdown}
            jsonData={{ board, measures: EBM_VALUE_AREAS.flatMap((a) => byArea[a]) }}
          />
        </div>
      </div>
      <p className="text-xs text-sub">
        {EBM_CREDIT}{" "}
        <a
          href={EBM_CREDIT_HREF}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          About Evidence-Based Management
        </a>
      </p>
      {problem && (
        <p className="text-sm text-danger" role="alert">
          {problem}
        </p>
      )}

      {!anything && (
        <EmptyState icon={Radar} action={<LoadExampleButton onLoad={loadExample} />}>
          <p className="text-sm">
            No evidence yet. Write the strategic goal, then add a measure or two in each key value
            area below, or look at an example first.
          </p>
        </EmptyState>
      )}

      <LadderCard ladder={ladder} onSave={saveGoal} />

      <EbmRadar scores={scores} />

      {editingMetric && (
        <SectionCard title={`Edit “${editingMetric.name}”`}>
          <MetricForm
            key={editingMetric.id}
            initial={metricDraftFor(editingMetric)}
            id={editingMetric.id}
            all={currentMetrics()}
            views={false}
            directionLockedBy={
              editingMetric.source ? SOURCE_INFO[editingMetric.source]?.label : undefined
            }
            submitLabel="Save the measure"
            onSave={saveEdit}
            onCancel={() => setEditingId(null)}
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

      <section aria-label="Key value areas" className="space-y-3">
        <Field
          label="What does your product do?"
          hint="One line, for Ask Amr. Nothing here is saved."
        >
          {(props) => (
            <Input
              {...props}
              maxLength={MEASURES_PRODUCT_MAX}
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {EBM_VALUE_AREAS.map((area) => (
            <AreaPanel
              key={area}
              area={area}
              measures={byArea[area]}
              allMetrics={metrics}
              readings={readings}
              experiments={experimentsFor(byArea[area], hypotheses)}
              aiInput={aiInput}
              onAdd={(values, source) => addMeasure(area, values, source)}
              onAddIdeas={(ideas) => addIdeas(area, ideas)}
              onReading={(m) => {
                setEditingId(null);
                setReadingFor(m.id);
              }}
              onEdit={(m) => {
                setReadingFor(null);
                setEditingId(m.id);
              }}
              onRemove={removeMeasure}
              removeWarning={removeWarning}
              onAcceptSource={(m, reading) =>
                addReading(m, { date: reading.date, value: reading.value }, m.source)
              }
            />
          ))}
        </div>
      </section>

      <SectionCard title="Reviews">
        <ReviewPanel
          reviews={reviews}
          today={today}
          suggest={() => ruleReview(reviewPool(currentMetrics()).byArea)}
          onRecord={recordReview}
        />
      </SectionCard>
    </div>
  );

  return (
    <ToolPageWrapper
      toolId="ebm-dashboard"
      title="EBM Dashboard"
      description="Measures in four key value areas, tied to your goals and experiments."
    >
      {content}
    </ToolPageWrapper>
  );
}
