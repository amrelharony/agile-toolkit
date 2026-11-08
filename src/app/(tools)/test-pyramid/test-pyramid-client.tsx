"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { Camera, Gauge, Trash2, Triangle } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ChartFigure } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { generateTestPyramidPrompts } from "@/lib/ai-prompts/test-pyramid";
import { enoughData } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { TEST_PYRAMID_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  PYRAMID_SHAPE_LABEL,
  PYRAMID_SNAPSHOT_MAX,
  TEST_LAYERS,
  TEST_LAYER_LABEL,
  TEST_PYRAMID_ID,
  classifyShape,
  hasAllRuntimes,
  layerShares,
  newSnapshotId,
  runCost,
  shapeHistory,
  shapeVerdict,
  sharePercents,
  snapshotOf,
  snapshotsOf,
  weightingOf,
  withSnapshot,
  withoutSnapshot,
} from "@/lib/quality/pyramid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  TestLayerRuntime,
  TestPyramid,
  TestPyramidSnapshot,
  TestPyramidWeighting,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import {
  CountsForm,
  RuntimeForm,
  SnapshotForm,
  type CountsValues,
  type SnapshotDraft,
} from "./forms";
import { pyramidMarkdown } from "./markdown";
import {
  compareWithNow,
  count,
  dayLabel,
  minutes,
  runCostText,
  shapeChartText,
  shapePoints,
  shareText,
  signed,
} from "./view";

// Recharts loads with the chart, not the page; the fixed-height box
// reserves the space while it does.
const ShapeOverTimeChart = dynamic(() => import("./charts").then((m) => m.ShapeOverTimeChart), {
  ssr: false,
});

/** Snapshots before the shape-over-time chart is drawn: one is a dot. */
const CHART_MIN_SNAPSHOTS = 2;

/** A change to the document: the next one, or null to remove it. */
type Write = (fn: (doc: TestPyramid | null) => TestPyramid | null) => void;

const storedDoc = () =>
  (useWorkspaceStore.getState().testPyramids ?? []).find((d) => d.id === TEST_PYRAMID_ID) ?? null;

/**
 * The synced singleton (TEST_PYRAMID_ID) that agents write too. Every write
 * starts from the stored document and spreads it, so the run times, the
 * weighting, the snapshots and updatedOn that the counts form doesn't show
 * are kept (the old hook upserted {id, counts, description} and erased them).
 */
function useTestPyramid(): [TestPyramid | null, Write] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.testPyramids ?? []).find((d) => d.id === TEST_PYRAMID_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertTestPyramid);
  const remove = useWorkspaceStore((s) => s.removeTestPyramid);
  const write: Write = (fn) => {
    const cur = storedDoc();
    const next = fn(cur);
    if (next === null) {
      if (cur) remove(TEST_PYRAMID_ID);
    } else if (next !== cur) {
      upsert({ ...next, id: TEST_PYRAMID_ID });
    }
  };
  return [doc ?? null, write];
}

/** Focus what `find` returns once React has re-rendered (the focused control may have gone). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

const firstFieldOf = (root: HTMLElement | null) =>
  root?.querySelector<HTMLElement>("input, select, textarea");

/**
 * The Delete buttons of the snapshots, one per snapshot in screen order.
 * The table and its phone cards both render them (one of the two hidden),
 * so the ones on screen are used when any are.
 */
function deleteButtons(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-delete-snapshot]"));
  const shown = all.filter((el) => el.getClientRects().length > 0);
  const seen = new Set<string>();
  return (shown.length > 0 ? shown : all).filter((el) => {
    const id = el.getAttribute("data-delete-snapshot") ?? "";
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const deleteButtonOf = (id: string) =>
  deleteButtons().find((el) => el.getAttribute("data-delete-snapshot") === id);

/** The snapshot after `id` on screen, else the one before it: where focus goes when it is deleted. */
function neighbourSnapshot(id: string): string | null {
  const ids = deleteButtons().map((el) => el.getAttribute("data-delete-snapshot"));
  const at = ids.indexOf(id);
  return (at < 0 ? null : (ids[at + 1] ?? ids[at - 1])) ?? null;
}

const WEIGHTING_LABEL: Record<TestPyramidWeighting, string> = {
  count: "Test count",
  runtime: "Run time",
};

export function TestPyramidClient() {
  const [stored, writeStored] = useTestPyramid();
  const today = todayLocalISO();
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<TestPyramid | null>(null);
  const preview = example !== null;
  const doc = example ?? stored;
  // Bound to the mode the change was made in, so an Undo lands where it
  // was made even if the example is loaded or cleared in between.
  const write: Write = preview
    ? (fn) => setExample((ex) => (ex ? (fn(ex) ?? ex) : ex))
    : writeStored;

  const { log: logHistory } = useHistoryLogger("test-pyramid");
  // The example's edits aren't the team's history, so they aren't logged.
  const log: typeof logHistory = (...args) => {
    if (!preview) logHistory(...args);
  };
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const countsRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLDivElement>(null);
  const [compareId, setCompareId] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const weighting = weightingOf(doc);
  const shares = doc ? layerShares(doc, weighting, doc.runtime) : null;
  const shape = classifyShape(shares);
  const verdict = shapeVerdict(shape, shares, weighting);
  const percents = shares ? sharePercents(shares) : null;
  const cost = doc ? runCost(doc, weighting, doc.runtime) : null;
  const total = doc ? doc.unit + doc.integration + doc.e2e : 0;
  const snapshots = useMemo(() => snapshotsOf(doc), [doc]);
  const points = useMemo(() => shapePoints(snapshots, weighting), [snapshots, weighting]);
  const chart = shapeChartText(points);
  const timed = hasAllRuntimes(doc?.runtime);
  const compared = snapshots.find((s) => s.id === compareId);
  // Nothing to share out and no snapshots is the first run. The old page
  // wrote {unit: 0, integration: 0, e2e: 0} as soon as a count field was
  // left, so a document alone doesn't mean the suite was counted: those
  // users still get the empty state and the example.
  const firstRun = !doc || (layerShares(doc) === null && snapshots.length === 0);

  /* ── Changes ── */

  function saveCounts(v: CountsValues) {
    const changed = TEST_LAYERS.filter((l) => doc?.[l] !== v[l]);
    const descriptionChanged = (doc?.description ?? undefined) !== v.description;
    if (doc && changed.length === 0 && !descriptionChanged) {
      announce("The counts are unchanged");
      return;
    }
    write((d) => {
      const next: TestPyramid = {
        ...(d ?? {}),
        id: TEST_PYRAMID_ID,
        unit: v.unit,
        integration: v.integration,
        e2e: v.e2e,
        updatedOn: today,
      };
      if (v.description) next.description = v.description;
      else delete next.description;
      return next;
    });
    log(TEST_PYRAMID_ACTIONS.COUNT_UPDATED, {
      fields: [...changed, ...(descriptionChanged ? ["description"] : [])],
    });
    const after = classifyShape(layerShares(v, weighting, doc?.runtime));
    announce(`Saved the counts. Shape: ${PYRAMID_SHAPE_LABEL[after]}`);
  }

  function saveRuntime(runtime: TestLayerRuntime) {
    if (TEST_LAYERS.every((l) => runtime[l] === doc?.runtime?.[l])) {
      announce("The minutes are unchanged");
      return;
    }
    // By run time needs all three: without them the page falls back to counts.
    const nextWeighting: TestPyramidWeighting =
      weighting === "runtime" && !hasAllRuntimes(runtime) ? "count" : weighting;
    write((d) => {
      if (!d) return d;
      const next: TestPyramid = { ...d, updatedOn: today };
      if (Object.keys(runtime).length > 0) next.runtime = runtime;
      else delete next.runtime;
      if (weightingOf(next) === "runtime" && !hasAllRuntimes(next.runtime)) {
        next.weighting = "count";
      }
      return next;
    });
    log(TEST_PYRAMID_ACTIONS.RUNTIME_UPDATED, { runtime, weighting: nextWeighting });
    announce(
      nextWeighting !== weighting
        ? "Saved the minutes. Weighing by test count: run time needs all three layers"
        : "Saved the minutes"
    );
  }

  function setWeighting(next: TestPyramidWeighting) {
    if (!doc || next === weighting) return;
    if (next === "runtime" && !timed) return;
    write((d) => (d ? { ...d, weighting: next } : d));
    log(TEST_PYRAMID_ACTIONS.RUNTIME_UPDATED, { runtime: doc.runtime ?? {}, weighting: next });
    announce(`Weighing the layers by ${WEIGHTING_LABEL[next].toLowerCase()}`);
  }

  function takeSnapshot({ takenOn, note }: SnapshotDraft) {
    if (!doc) return;
    const id = preview ? exampleId(`tps-${nanoid(6)}`) : newSnapshotId();
    const snapshot = snapshotOf(doc, takenOn, id, note);
    write((d) => (d ? withSnapshot(d, snapshot) : d));
    log(TEST_PYRAMID_ACTIONS.SNAPSHOT_TAKEN, { snapshotId: id, takenOn });
    announce(`Snapshot kept for ${dayLabel(takenOn)}`);
  }

  function removeSnapshot(s: TestPyramidSnapshot) {
    if (compareId === s.id) setCompareId("");
    // The focused Delete button goes with its row: focus moves to the
    // neighbouring row's, or to the snapshot form once none are left.
    const near = neighbourSnapshot(s.id);
    focusSoon(() => (near && deleteButtonOf(near)) || firstFieldOf(snapshotRef.current));
    undoable({
      label: `Deleted the snapshot of ${dayLabel(s.takenOn)}`,
      apply: () => {
        write((d) => (d ? (withoutSnapshot(d, s.id) ?? d) : d));
        log(TEST_PYRAMID_ACTIONS.SNAPSHOT_REMOVED, { snapshotId: s.id, takenOn: s.takenOn });
      },
      revert: () =>
        write((d) =>
          d && !(d.snapshots ?? []).some((x) => x.id === s.id) ? withSnapshot(d, s) : d
        ),
    });
    announce(`Deleted the snapshot of ${dayLabel(s.takenOn)}`);
  }

  /** Each clear keeps the document it took for its own Undo. */
  function clearAll() {
    const before = storedDoc();
    if (!before) return;
    setCompareId("");
    undoable({
      label: "Cleared the counts and snapshots",
      apply: () => {
        write(() => null);
        log(TEST_PYRAMID_ACTIONS.PYRAMID_RESET, { snapshots: (before.snapshots ?? []).length });
      },
      // A pyramid counted again since is kept: Undo never overwrites it.
      revert: () => write((d) => d ?? before),
    });
    // The Clear button goes with the shape card: start again from the counts.
    focusSoon(() => firstFieldOf(countsRef.current));
  }

  /* ── Exports ── */

  const countShares = doc ? layerShares(doc) : null;
  const countPct = countShares ? sharePercents(countShares) : null;
  const promptConfig = useMemo(
    () => ({
      toolName: "Test Pyramid Analyzer",
      // The page's shape, weighting, run cost and snapshots, read from the document.
      prompts: generateTestPyramidPrompts({ doc }),
    }),
    [doc]
  );

  const csvData = {
    headers: ["Layer", "Tests", "Share of tests (%)", "Relative run cost", "Minutes"],
    rows: doc
      ? TEST_LAYERS.map((l) => [
          TEST_LAYER_LABEL[l],
          doc[l],
          countPct ? countPct[l] : "",
          runCost(doc)?.byLayer[l] ?? "",
          typeof doc.runtime?.[l] === "number" ? (doc.runtime[l] as number) : "",
        ])
      : [],
  };

  const pointOf = new Map(points.map((p) => [p.id, p]));
  const columns: DataTableColumn<TestPyramidSnapshot>[] = [
    { key: "day", header: "Day", primary: true, cell: (s) => dayLabel(s.takenOn) },
    ...TEST_LAYERS.map(
      (l): DataTableColumn<TestPyramidSnapshot> => ({
        key: l,
        header: TEST_LAYER_LABEL[l],
        align: "right",
        cell: (s) => <span className="font-data">{count(s[l])}</span>,
      })
    ),
    { key: "shape", header: "Shape", cell: (s) => pointOf.get(s.id)?.shape ?? "—" },
    {
      key: "note",
      header: "Note",
      hiddenBelow: "lg",
      cell: (s) => <span className="text-sub">{s.note ?? ""}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (s) => (
        <IconButton
          data-delete-snapshot={s.id}
          label={`Delete the snapshot of ${dayLabel(s.takenOn)}`}
          icon={<Trash2 aria-hidden="true" />}
          onClick={() => removeSnapshot(s)}
          className="text-sub hover:text-danger"
        />
      ),
    },
  ];

  const unitSeries = shapeHistory(snapshots, weighting)
    .map((p) => p.unitShare)
    .filter((x): x is number => x !== null);
  const unitTrend = enoughData(unitSeries.length, "trend") ? mannKendall(unitSeries) : null;
  // On the page's weighting, so it names the same shapes as the Shape card and the table.
  const comparison = compared && doc ? compareWithNow(compared, doc, weighting) : null;
  const runCostCard = runCostText(cost);
  const maxShare = shares ? Math.max(shares.unit, shares.integration, shares.e2e) : 0;

  return (
    <ToolPageWrapper
      toolId="test-pyramid"
      title="Test Pyramid Analyzer"
      description="Enter your test counts per layer to see the shape they make (pyramid, ice-cream cone, hourglass or diamond), what a run costs, and how the shape changes across snapshots."
      category="Quality Engineering"
    >
      <div ref={exportRef} className="space-y-6">
        {preview && (
          <ExampleNotice
            onClear={() => {
              setExample(null);
              setCompareId("");
            }}
          />
        )}

        <SectionCard title="Test counts" icon={Triangle} contentClassName="space-y-3">
          <div ref={countsRef}>
            {/* The form follows a save from elsewhere itself (useStoredItemForm). */}
            <CountsForm key={preview ? "example" : "saved"} doc={doc} onSave={saveCounts} />
          </div>
          {doc?.updatedOn && (
            // Stamped by a save of the counts or the minutes (as set_counts stamps it).
            <p className="text-xs text-sub">Last saved {dayLabel(doc.updatedOn)}.</p>
          )}
        </SectionCard>

        {firstRun || !doc ? (
          <EmptyState
            icon={Triangle}
            action={<LoadExampleButton onLoad={() => setExample(buildExample(today))} />}
          >
            Not counted yet. Enter the number of tests in each layer above to see the shape, or load
            an example of a suite moving from an ice-cream cone to a pyramid.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm font-medium text-text">{verdict}</p>

            <KpiGrid cols={4}>
              <StatCard
                variant="compact"
                icon={Triangle}
                label="Total tests"
                value={count(total)}
                valueClassName="text-accent"
              />
              <StatCard
                variant="compact"
                label="Shape"
                value={PYRAMID_SHAPE_LABEL[shape]}
                hint={weighting === "runtime" ? "By run time" : "By test count"}
                tone={
                  shape === "pyramid"
                    ? "success"
                    : shape === "ice-cream-cone" || shape === "hourglass"
                      ? "warning"
                      : "default"
                }
              />
              <StatCard
                variant="compact"
                label={weighting === "runtime" ? "Unit share of run time" : "Unit share of tests"}
                value={percents ? `${percents.unit}%` : "—"}
                hint={percents ? `E2E ${percents.e2e}%` : undefined}
              />
              <StatCard
                variant="compact"
                icon={Gauge}
                label={cost?.basis === "runtime" ? "Run time" : "Relative run cost"}
                value={runCostCard.value}
                hint={runCostCard.hint}
              />
            </KpiGrid>

            <SectionCard
              title="Pyramid shape"
              icon={Triangle}
              contentClassName="space-y-4"
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="test-pyramid"
                    csvData={csvData}
                    jsonData={doc}
                    markdown={pyramidMarkdown(doc)}
                    targetRef={exportRef}
                  />
                  {!preview && (
                    <>
                      <Button
                        type="button"
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => setConfirmClear(true)}
                      >
                        <Trash2 aria-hidden="true" />
                        Clear
                      </Button>
                      <ConfirmDialog
                        open={confirmClear}
                        onOpenChange={setConfirmClear}
                        title="Clear the counts and snapshots?"
                        description={`The counts, run times and ${snapshots.length === 1 ? "1 snapshot" : `${snapshots.length} snapshots`} go, for agents too.`}
                        confirmLabel="Clear"
                        onConfirm={clearAll}
                      />
                    </>
                  )}
                </>
              }
            >
              <ol className="space-y-3" aria-label="Layers, top of the pyramid first">
                {[...TEST_LAYERS].reverse().map((l) => {
                  const share = shares ? shares[l] : 0;
                  const width = maxShare > 0 ? `${(share / maxShare) * 100}%` : "0%";
                  const time = doc.runtime?.[l];
                  return (
                    <li key={l} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-sub sm:w-24">
                        {TEST_LAYER_LABEL[l]}
                      </span>
                      <span className="relative h-8 min-w-0 flex-1 overflow-hidden rounded bg-surface">
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 rounded border-r-2 border-accent bg-accent/20 transition-all"
                          style={{ width }}
                        />
                        <span className="absolute inset-0 flex items-center gap-2 px-2 text-xs font-data">
                          <span className="text-text">{count(doc[l])}</span>
                          {typeof time === "number" && (
                            <span className="text-sub">{minutes(time)}</span>
                          )}
                          <span className="text-sub">({percents ? `${percents[l]}%` : "—"})</span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className="space-y-1.5">
                <span className="text-sm text-text" aria-hidden="true">
                  Weigh the layers by
                </span>
                <ToggleGroup
                  label="Weigh the layers by"
                  size="sm"
                  value={weighting}
                  onValueChange={setWeighting}
                  aria-describedby="pyramid-weighting-note"
                  options={[
                    { value: "count", label: WEIGHTING_LABEL.count },
                    {
                      value: "runtime",
                      label: WEIGHTING_LABEL.runtime,
                      disabled: !timed,
                      description: timed
                        ? undefined
                        : "Enter the minutes of all three layers first",
                    },
                  ]}
                />
                <p id="pyramid-weighting-note" className="text-xs text-sub">
                  {timed
                    ? "By run time, the minutes each layer takes replace the fixed 1 / 5 / 25 weights."
                    : "Run time needs the minutes of all three layers (below)."}
                </p>
              </div>

              <details
                className="group rounded-lg border border-border"
                open={Boolean(doc.runtime)}
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm text-text [&::-webkit-details-marker]:hidden">
                  Run time per layer (optional)
                </summary>
                <div className="border-t border-border p-3">
                  <RuntimeForm
                    key={preview ? "example" : "saved"}
                    runtime={doc.runtime}
                    onSave={saveRuntime}
                  />
                </div>
              </details>
            </SectionCard>

            <SectionCard
              title={`Snapshots (${snapshots.length})`}
              icon={Camera}
              contentClassName="space-y-4"
            >
              <div ref={snapshotRef}>
                {snapshots.length >= PYRAMID_SNAPSHOT_MAX ? (
                  <p className="text-sm text-sub">
                    A pyramid keeps at most {PYRAMID_SNAPSHOT_MAX} snapshots: delete one to take
                    another.
                  </p>
                ) : (
                  <SnapshotForm
                    key={preview ? "example" : "saved"}
                    today={today}
                    onSave={takeSnapshot}
                  />
                )}
              </div>

              {snapshots.length === 0 ? (
                <p className="text-sm text-sub">
                  No snapshots yet. Take one now and again after a release or a cleanup to see the
                  shape change.
                </p>
              ) : (
                <>
                  <DataTable
                    caption="Snapshots, oldest first"
                    columns={columns}
                    rows={snapshots}
                    rowKey={(s) => s.id}
                  />

                  <Field label="Compare today's counts with" className="sm:max-w-xs">
                    {(props) => (
                      <select
                        {...props}
                        className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm"
                        value={compareId}
                        onChange={(e) => setCompareId(e.target.value)}
                      >
                        <option value="">Pick a snapshot</option>
                        {[...snapshots].reverse().map((s) => (
                          <option key={s.id} value={s.id}>
                            {dayLabel(s.takenOn)}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  {comparison && compared && (
                    <div className="scroll-x-snap relative">
                      <table className="w-full min-w-[22rem] text-sm">
                        <caption className="mb-2 text-left text-xs text-sub">
                          {dayLabel(compared.takenOn)}: {comparison.thenShape.toLowerCase()} · now:{" "}
                          {comparison.nowShape.toLowerCase()} (shares {comparison.basis})
                        </caption>
                        <thead>
                          <tr className="border-b border-border text-xs uppercase tracking-wide text-sub">
                            <th className="px-2 py-1.5 text-left font-medium">Layer</th>
                            <th className="px-2 py-1.5 text-right font-medium">
                              {dayLabel(compared.takenOn)}
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium">Now</th>
                            <th className="px-2 py-1.5 text-right font-medium">Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.rows.map((r) => (
                            <tr key={r.layer} className="border-b border-border last:border-0">
                              <th scope="row" className="px-2 py-1.5 text-left font-normal">
                                {r.label}
                              </th>
                              <td className="px-2 py-1.5 text-right font-data">
                                {count(r.then)} ({shareText(r.thenPct)})
                              </td>
                              <td className="px-2 py-1.5 text-right font-data">
                                {count(r.now)} ({shareText(r.nowPct)})
                              </td>
                              <td className="px-2 py-1.5 text-right font-data">
                                {signed(r.change)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {points.length >= CHART_MIN_SNAPSHOTS ? (
                <ChartFigure
                  label="Layer shares across snapshots"
                  summary={chart.summary}
                  table={chart.table}
                  plotClassName="h-[220px]"
                >
                  <ShapeOverTimeChart
                    data={points.map((p) => ({
                      day: dayLabel(p.takenOn),
                      unit: p.percents?.unit ?? null,
                      integration: p.percents?.integration ?? null,
                      e2e: p.percents?.e2e ?? null,
                    }))}
                  />
                </ChartFigure>
              ) : (
                <NotEnoughData
                  have={points.length}
                  need={CHART_MIN_SNAPSHOTS}
                  unit={["snapshot", "snapshots"]}
                  action="Take"
                  what="the shape over time"
                />
              )}
            </SectionCard>

            <AdvancedAnalysis>
              {unitTrend ? (
                <p className="text-sm text-text">
                  Mann-Kendall on the unit share over {unitSeries.length} snapshots:{" "}
                  {unitTrend.trend === "none" || !unitTrend.significant
                    ? "no clear trend"
                    : `trending ${unitTrend.trend}`}{" "}
                  (p = {unitTrend.pValue.toFixed(3)}).
                </p>
              ) : (
                <NotEnoughData
                  have={unitSeries.length}
                  need="trend"
                  unit={["snapshot", "snapshots"]}
                  action="Take"
                  what="a trend test on the unit share"
                />
              )}
            </AdvancedAnalysis>
          </>
        )}

        <CalloutAlert tone="info">
          <strong>How to read this:</strong> a healthy suite is unit-heavy, with a thin layer of
          e2e. Layers within 5 points of each other count as level, so a small change between
          near-equal layers doesn&apos;t flip the shape. Relative run cost weighs each test by the
          rule of thumb unit 1, integration 5, e2e 25; enter real minutes per layer to weigh by run
          time instead.
        </CalloutAlert>
      </div>
    </ToolPageWrapper>
  );
}
