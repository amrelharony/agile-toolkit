"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Keyboard, Layers } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ResetButton } from "@/components/shared/reset-button";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { generateCFDPrompts } from "@/lib/ai-prompts/cumulative-flow";
import { enoughData } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/charts/chart-text";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CFD_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KANBAN_BOARD_ID, type Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { todayIso } from "@/lib/sprints/series";
import { parseNumber } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";
import { DEFAULT_FLOW_RANGE, FLOW_RANGES, type FlowRangeDays } from "./constants";
import { useCFDStore } from "./use-cfd-store";
import type { CfdSource, DataEntry, StatusColumn, TypedSnapshotState } from "./types";
import { autoSource, boardWipLimit, cfdMetrics, flowView, sprintView, typedView } from "./view";
import { cfdVerdict, itemNoun } from "./verdict";
import { analyseWip, trendSentence } from "./analysis";
import { cfdToMarkdown } from "./markdown";
import { buildExample, type CfdExample } from "./example";
import { StatCard } from "./components/stat-card";
import { FlowChart } from "./components/flow-chart";
import { WipControlChart } from "./components/wip-control-chart";
import { DataEntryTable } from "./components/data-entry-table";
import { SnapshotForm } from "./components/snapshot-form";
import { ColumnsCard } from "./components/columns-card";

export const TOOL_ID = "cumulative-flow";

const NO_STORIES: Story[] = [];

const SOURCES: { id: CfdSource; label: string }[] = [
  { id: "sprint", label: "Sprint board" },
  { id: "flow", label: "Flow board" },
  { id: "typed", label: "Typed snapshots" },
];

const DAYS = ["day", "days"] as const;
const SNAPSHOTS = ["snapshot", "snapshots"] as const;

/** The values of every `data-<name>` on the page, in page order, each once. */
function dataValues(name: string): string[] {
  const values = Array.from(document.querySelectorAll<HTMLElement>(`[data-${name}]`)).map(
    (el) => el.getAttribute(`data-${name}`) ?? ""
  );
  return Array.from(new Set(values));
}

/** The `data-<name>` value after `value` on the page, else the one before it. */
function neighbourOf(name: string, value: string): string | undefined {
  const all = dataValues(name);
  const at = all.indexOf(value);
  return at >= 0 ? (all[at + 1] ?? all[at - 1]) : undefined;
}

/**
 * The element whose `data-<name>` is `value`, the one on screen: a table
 * draws each row twice (a table from md up, cards below it), one hidden.
 * Ids go in no selector, so need no escaping.
 */
function onScreen(name: string, value: string): HTMLElement | undefined {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-${name}]`)).filter(
    (el) => el.getAttribute(`data-${name}`) === value
  );
  return all.find((el) => el.getClientRects().length > 0) ?? all[0];
}

/**
 * Focus what `find` returns once React has re-rendered: deleting a
 * snapshot or a column unmounts the button that had focus, and focus
 * would otherwise drop to <body>.
 */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/**
 * Cumulative Flow Diagram: how many items sat in each stage, day by day.
 * Generated from the Sprint board's status history (the selected sprint's
 * stories) or the Flow board's card history, read live through lib/flow so
 * it never goes stale; snapshots typed by hand stay as the fallback for a
 * board kept elsewhere. Reads off WIP, throughput per elapsed day and a
 * Little's Law lead time, with the control chart and trend test behind
 * Advanced analysis once there are enough points.
 */
export function CFDClient() {
  const hydrated = useWorkspaceHydrated();
  const { sprints, selected, select } = useSelectedSprint();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const board = (kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID);
  const {
    columns,
    entries,
    wipLimit,
    source: chosen,
    setSource,
    addColumn,
    removeColumn,
    restoreColumn,
    renameColumn,
    setColumnDescription,
    addEntry,
    updateEntry,
    restoreEntry,
    updateEntryCount,
    setWipLimit,
    reset,
    restore,
  } = useCFDStore();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [flowDays, setFlowDays] = useState<FlowRangeDays>(DEFAULT_FLOW_RANGE);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<CfdExample | null>(null);
  const preview = example !== null;
  const resetSnapshot = useRef<TypedSnapshotState | null>(null);
  const snapshotFormRef = useRef<HTMLDivElement>(null);
  const flowTitleId = useId();

  const sprintV = useMemo(
    () =>
      example
        ? sprintView(example.stories, example.sprint, today, { includeExamples: true })
        : sprintView(stories, selected, today),
    [example, stories, selected, today]
  );
  const flowV = useMemo(() => flowView(board, today, flowDays), [board, today, flowDays]);
  const typedV = useMemo(() => typedView(columns, entries), [columns, entries]);

  const auto = autoSource({
    sprint: sprintV.itemCount > 0,
    flow: flowV.itemCount > 0,
    typed: entries.length > 0,
  });
  const source: CfdSource | null = preview ? "sprint" : (chosen ?? auto);
  const view = source === "sprint" ? sprintV : source === "flow" ? flowV : source ? typedV : null;
  const metrics = useMemo(() => (view ? cfdMetrics(view) : null), [view]);
  const analysis = useMemo(() => analyseWip(metrics?.wipSeries ?? []), [metrics]);
  // The example is no one's board: the user's Flow board limits don't apply to it.
  const limit = source === "typed" ? wipLimit : source && !preview ? boardWipLimit(board) : null;
  const hasActiveStage = view?.workflow.stages.some((s) => s.kind === "active") ?? false;
  const sprintName = preview ? example?.sprint.name : selected?.name;
  const verdict = view && metrics ? cfdVerdict(view, metrics) : "";
  const markdown =
    view && metrics ? cfdToMarkdown(view, metrics, { today, sprintName, wipLimit: limit }) : "";
  const unit = source === "typed" ? SNAPSHOTS : DAYS;
  const nothing =
    !preview &&
    sprintV.itemCount === 0 &&
    flowV.itemCount === 0 &&
    entries.length === 0 &&
    chosen !== "typed";

  /* ── Changes ──────────────────────────────────────────────────────── */

  const pickSource = (next: CfdSource) => {
    if (next === source) return;
    setSource(next);
    log(CFD_ACTIONS.SOURCE_SWITCHED, { source: next });
    announce(`Showing ${SOURCES.find((s) => s.id === next)?.label}`);
  };

  const addSnapshot = (entry: Omit<DataEntry, "id">) => {
    if (!addEntry(entry)) {
      announce(`A snapshot for ${entry.date} already exists`);
      return;
    }
    log(CFD_ACTIONS.SNAPSHOT_LOGGED, { date: entry.date, entryCount: entries.length + 1 });
    announce(`Added the snapshot for ${entry.date}`);
  };

  const removeEntry = (entry: DataEntry) => {
    // Focus moves on to the next snapshot's Delete as the table shows them
    // (else the previous one's), or to the Add a snapshot form.
    const neighbour = neighbourOf("snapshot-delete", entry.id);
    const index = useCFDStore.getState().entries.findIndex((e) => e.id === entry.id);
    undoable({
      label: `Deleted the snapshot from ${entry.date}`,
      apply: () =>
        useCFDStore.setState((s) => ({ entries: s.entries.filter((e) => e.id !== entry.id) })),
      // Through the store's one-per-date rule: a snapshot typed for this
      // date during the Undo window stays, and this one doesn't come back.
      revert: () => {
        if (!restoreEntry(entry, index)) {
          toast(`Kept the snapshot typed for ${entry.date} since: one date has one snapshot.`);
          announce(`Not restored: ${entry.date} already has a snapshot`);
        }
      },
    });
    log(CFD_ACTIONS.SNAPSHOT_REMOVED, { date: entry.date });
    announce(`Deleted the snapshot from ${entry.date}`);
    focusSoon(() =>
      neighbour
        ? onScreen("snapshot-delete", neighbour)
        : snapshotFormRef.current?.querySelector<HTMLElement>("input")
    );
  };

  const removeCol = (column: StatusColumn) => {
    // Undo puts the column back in its place with every snapshot's count.
    const index = columns.findIndex((c) => c.id === column.id);
    const counts = Object.fromEntries(
      entries
        .filter((e) => e.counts[column.id] !== undefined)
        .map((e) => [e.id, e.counts[column.id]])
    );
    // Focus goes to the next column (else the previous one): its Remove,
    // or its name once two columns are left and Remove is gone.
    const next = columns[index + 1] ?? columns[index - 1];
    undoable({
      label: `Removed the ${column.name} column`,
      apply: () => removeColumn(column.id),
      revert: () => restoreColumn(column, index, counts),
    });
    log(CFD_ACTIONS.COLUMN_REMOVED, { name: column.name });
    announce(`Removed the ${column.name} column`);
    if (next) {
      focusSoon(
        () =>
          onScreen("column-remove", next.id) ??
          document.getElementById(`cfd-column-name-${next.id}`)
      );
    }
  };

  const addCol = (name: string, description?: string) => {
    addColumn(name, description);
    log(CFD_ACTIONS.COLUMN_ADDED, { name, description });
    announce(`Added the ${name} column`);
  };

  const loadExample = () => setExample(buildExample(today));

  /* ── WIP limit (typed snapshots: the boards keep their own) ────────── */

  const [wipDraft, setWipDraft] = useState("");
  const [wipError, setWipError] = useState<string | null>(null);
  const applyWip = () => {
    const n = parseNumber(wipDraft);
    if (n === undefined || !Number.isInteger(n) || n < 1) {
      setWipError("Enter the most items you allow in progress: a whole number from 1.");
      return;
    }
    setWipError(null);
    setWipLimit(n);
    setWipDraft("");
    announce(`WIP limit set to ${n}`);
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "Cumulative Flow Diagram",
      prompts: view
        ? generateCFDPrompts({
            columns: view.workflow.stages.map((s) => ({ id: s.id, name: s.label })),
            entries: view.days.map((d) => ({ date: d.date, counts: { ...d.counts } })),
            wipLimit: limit,
          })
        : [],
    }),
    [view, limit]
  );

  const csvData = useMemo(() => {
    const stages = view?.workflow.stages ?? [];
    return {
      headers: ["Date", ...stages.map((s) => s.label)],
      rows: (view?.days ?? []).map((d) => [d.date, ...stages.map((s) => d.counts[s.id] ?? 0)]),
    };
  }, [view]);

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId={TOOL_ID}
        title="Cumulative Flow Diagram"
        description="See how work flows through your stages, from your Sprint or Flow board: widening bands are bottlenecks."
        category="Metrics & Dashboards"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the boards…
        </p>
      </ToolPageWrapper>
    );
  }

  const latest = metrics?.latest ?? null;
  const measured = metrics?.measured ?? null;
  const overLimit = limit !== null && latest?.wip != null && latest.wip > limit;

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Cumulative Flow Diagram"
      description="See how work flows through your stages, from your Sprint or Flow board: widening bands are bottlenecks."
      category="Metrics & Dashboards"
    >
      <div className="space-y-6">
        {preview && (
          <div>
            <ExampleNotice onClear={() => setExample(null)} />
            <p className="-mt-2 text-xs text-sub">
              Example: a checkout team&apos;s Sprint board, ten days in. Nothing in it is saved, and
              your own boards stay as they are.
            </p>
          </div>
        )}

        {nothing ? (
          <EmptyState
            icon={Layers}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LoadExampleButton onLoad={loadExample} />
                <Button type="button" variant="ghost" size="sm" onClick={() => pickSource("typed")}>
                  <Keyboard aria-hidden="true" />
                  Type snapshots instead
                </Button>
              </div>
            }
          >
            Nothing to chart yet. Move stories on the{" "}
            <Link href="/kanban" className="font-medium text-accent hover:underline">
              Sprint or Flow board
            </Link>{" "}
            and the chart builds itself, day by day, from their moves.
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p id={`${flowTitleId}-source`} className="mb-1 text-xs font-medium text-sub">
                  Chart from
                </p>
                <div
                  role="group"
                  aria-labelledby={`${flowTitleId}-source`}
                  className="flex flex-wrap gap-1"
                >
                  {SOURCES.map((s) => (
                    <Button
                      key={s.id}
                      type="button"
                      size="sm"
                      variant={source === s.id ? "default" : "outline"}
                      aria-pressed={source === s.id}
                      disabled={preview && s.id !== "sprint"}
                      onClick={() => pickSource(s.id)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
              {source === "sprint" && !preview && sprints.length > 0 && (
                <SprintPicker
                  sprints={sprints}
                  selectedId={selected?.id}
                  onSelect={select}
                  allowCreate={false}
                />
              )}
              {source === "flow" && (
                <div>
                  <p id={`${flowTitleId}-range`} className="mb-1 text-xs font-medium text-sub">
                    Last
                  </p>
                  <div role="group" aria-labelledby={`${flowTitleId}-range`} className="flex gap-1">
                    {FLOW_RANGES.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={flowDays === d ? "default" : "outline"}
                        aria-pressed={flowDays === d}
                        onClick={() => setFlowDays(d)}
                      >
                        {d} days
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {source === "sprint" && !preview && sprints.length === 0 && (
              <p className="text-sm text-sub">
                No sprints yet.{" "}
                <Link href="/sprint-planning" className="font-medium text-accent hover:underline">
                  Plan one in Sprint Planning
                </Link>{" "}
                and its stories chart here as they move.
              </p>
            )}

            {view && metrics && (
              <>
                <p className="text-sm font-medium text-text" aria-live="polite">
                  {verdict}
                </p>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatCard
                    label={
                      view.source === "typed" ? "Items (latest snapshot)" : "Items on the board"
                    }
                    value={latest ? latest.total : "—"}
                    accent
                  />
                  <StatCard
                    label="Work in progress"
                    value={latest?.wip ?? "—"}
                    unit={
                      latest?.wip == null
                        ? // Only when there's no column to count it in; with no snapshot
                          // yet, the line under the tiles says what's missing.
                          view.source === "typed" && !hasActiveStage
                          ? "add a middle column"
                          : undefined
                        : limit !== null
                          ? `of ${limit} allowed`
                          : undefined
                    }
                    warning={overLimit}
                  />
                  <StatCard
                    label="Throughput"
                    value={
                      metrics.throughputPerDay === null ? "—" : fmt(metrics.throughputPerDay, 2)
                    }
                    unit={metrics.throughputPerDay === null ? undefined : `${itemNoun(view)} a day`}
                  />
                  <StatCard
                    label="Lead time (Little's Law)"
                    value={metrics.littles ? `≈ ${fmt(metrics.littles.leadTimeDays)}` : "—"}
                    unit={metrics.littles ? "days" : undefined}
                    footer={
                      measured && measured.average !== null && enoughData(measured.count, "average")
                        ? `Measured: ${fmt(measured.average)} days over ${measured.count} finished`
                        : view.source === "typed"
                          ? "Average WIP ÷ throughput, a same-day item as 1 day"
                          : undefined
                    }
                  />
                </div>
                {!metrics.enough && view.days.length > 0 && (
                  <NotEnoughData
                    have={metrics.points}
                    need="average"
                    unit={unit}
                    action={view.source === "typed" ? "Log" : "Wait"}
                    what="throughput and a Little's Law lead time"
                  />
                )}
                {overLimit && (
                  <p className="flex items-start gap-2 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {latest?.wip} in progress, over the limit of {limit}: finish something before
                    pulling more in.
                  </p>
                )}

                <SectionCard
                  title={<span id={flowTitleId}>Flow Diagram</span>}
                  icon={Layers}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <AiPromptGenerator config={promptConfig} />
                      <ExportButton
                        filename="cumulative-flow"
                        markdown={markdown}
                        clipboardText={markdown}
                        csvData={csvData}
                        jsonData={{
                          source: view.source,
                          stages: view.workflow.stages,
                          days: view.days,
                        }}
                      />
                      {view.source === "typed" && !preview && entries.length > 0 && (
                        <ResetButton
                          label="Clear snapshots"
                          title="Clear every typed snapshot?"
                          description={`All ${entries.length} snapshots and the WIP limit go; the columns stay. You can undo this for a few seconds.`}
                          confirmLabel="Clear snapshots"
                          doneLabel="Cleared the typed snapshots"
                          onReset={() => {
                            const s = useCFDStore.getState();
                            resetSnapshot.current = {
                              columns: s.columns,
                              entries: s.entries,
                              wipLimit: s.wipLimit,
                            };
                            reset();
                            log(CFD_ACTIONS.CFD_RESET, { entries: s.entries.length });
                          }}
                          onUndo={() => {
                            if (resetSnapshot.current) restore(resetSnapshot.current);
                          }}
                        />
                      )}
                    </div>
                  }
                >
                  {view.days.length === 0 ? (
                    <p className="py-10 text-center text-sm text-sub">
                      {view.source === "typed"
                        ? "Add a snapshot below to start the chart."
                        : view.source === "sprint" && selected && view.itemCount > 0
                          ? `The chart starts on the sprint's first day, ${selected.startDate}.`
                          : view.source === "sprint"
                            ? "This sprint has no stories yet: plan some in, and they chart here as they move."
                            : "No cards on the Flow board yet."}
                    </p>
                  ) : (
                    <FlowChart
                      days={view.days}
                      stages={view.workflow.stages}
                      labelledBy={flowTitleId}
                    />
                  )}
                  {view.approximate > 0 && (
                    <p className="mt-3 text-xs text-sub">
                      {view.approximate === 1 ? "1 item" : `${view.approximate} items`} placed from
                      their start and done times; their move history wasn&apos;t kept.
                    </p>
                  )}
                  {metrics.doneDrops.map((d) => (
                    <p key={d.date} className="mt-2 flex items-start gap-2 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Done fell from {d.from} to {d.to} on {d.date}: Done is a running total, so
                      check that snapshot&apos;s counts.
                    </p>
                  ))}
                  {view.source !== "typed" && !preview && (
                    <p className="mt-3 text-xs text-sub">
                      {limit !== null
                        ? `WIP limit ${limit} (In progress and Review together), from the board. `
                        : "No WIP limit on In progress and Review yet. "}
                      <Link
                        href="/kanban"
                        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                      >
                        Change it on the Kanban board
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </p>
                  )}
                </SectionCard>

                <AdvancedAnalysis summary="Advanced analysis: WIP control chart and trend">
                  {metrics.wipSeries.length === 0 ? (
                    <p className="text-sm text-sub">
                      Add a column between the first and the last to count work in progress.
                    </p>
                  ) : (
                    <>
                      {analysis.limits ? (
                        <WipControlChart
                          wipSeries={metrics.wipSeries}
                          wipLimits={analysis.limits}
                          wipLimit={limit}
                          cusumAnnotations={analysis.shifts}
                          signals={analysis.signals}
                          unit={unit}
                        />
                      ) : (
                        <NotEnoughData
                          have={metrics.wipSeries.length}
                          need="changePoint"
                          unit={unit}
                          action={view.source === "typed" ? "Log" : "Wait"}
                          what="WIP control limits and change points"
                        />
                      )}
                      {analysis.trend ? (
                        <p className="text-sm text-text">{trendSentence(analysis.trend)}</p>
                      ) : (
                        <NotEnoughData
                          have={metrics.wipSeries.length}
                          need="trend"
                          unit={unit}
                          action={view.source === "typed" ? "Log" : "Wait"}
                          what="whether WIP is trending"
                        />
                      )}
                    </>
                  )}
                </AdvancedAnalysis>
              </>
            )}

            {source === "typed" && !preview && (
              <>
                <SectionCard title="Add a snapshot" icon={Keyboard}>
                  <p className="mb-3 text-xs text-sub">
                    For a board the toolkit can&apos;t read: count the items in each column on a
                    day. Done is a running total.
                  </p>
                  <div ref={snapshotFormRef}>
                    <SnapshotForm
                      columns={columns}
                      entries={entries}
                      today={today}
                      onAdd={addSnapshot}
                    />
                  </div>
                </SectionCard>

                {entries.length > 0 && (
                  <SectionCard title="Snapshots" icon={Layers}>
                    <DataEntryTable
                      entries={entries}
                      columns={columns}
                      today={today}
                      onUpdateDate={(e, date) => updateEntry(e.id, { date })}
                      onUpdateNote={(e, description) => updateEntry(e.id, { description })}
                      onUpdateCount={(e, columnId, n) => updateEntryCount(e.id, columnId, n)}
                      onRemoveEntry={removeEntry}
                    />
                  </SectionCard>
                )}

                <SectionCard
                  title="WIP limit (optional)"
                  icon={AlertTriangle}
                  iconClassName="text-warning"
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Most items in progress" error={wipError} className="w-48">
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          placeholder={wipLimit !== null ? String(wipLimit) : "e.g. 10"}
                          value={wipDraft}
                          onChange={(e) => setWipDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") applyWip();
                          }}
                        />
                      )}
                    </Field>
                    <Button type="button" size="sm" variant="outline" onClick={applyWip}>
                      {wipLimit !== null ? "Change" : "Set"}
                    </Button>
                    {wipLimit !== null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger-ghost"
                        onClick={() => {
                          setWipLimit(null);
                          announce("WIP limit cleared");
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <p
                    className={cn("mt-2 text-xs", wipLimit !== null ? "text-warning" : "text-sub")}
                  >
                    {wipLimit !== null
                      ? `WIP limit set at ${wipLimit} items — shown as a dashed line on the WIP control chart (Advanced analysis).`
                      : "Shown as a dashed line on the WIP control chart, under Advanced analysis."}
                  </p>
                </SectionCard>

                <ColumnsCard
                  columns={columns}
                  onAdd={addCol}
                  onRename={(c, name) => renameColumn(c.id, name)}
                  onDescribe={(c, description) => setColumnDescription(c.id, description)}
                  onRemove={removeCol}
                />
              </>
            )}
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
