"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Clock, Hourglass, Keyboard, ListChecks, Target } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ResetButton } from "@/components/shared/reset-button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateCycleTimePrompts } from "@/lib/ai-prompts/cycle-time";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/charts/chart-text";
import { STAGE_LABEL, cleanStageIds, type StageId } from "@/lib/flow";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CYCLE_TIME_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KANBAN_BOARD_ID, type KanbanCard, type Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayIso } from "@/lib/sprints/series";
import { parseNumber } from "@/lib/utils/form";
import { removeWithUndo } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { useCycleTimeStore } from "./use-cycle-time-store";
import { SLE_PERCENTILES, type CycleSource, type SlePercentile, type WorkItem } from "./types";
import {
  PERCENTILE_KEYS,
  SOURCE_LABEL,
  ageingRows,
  boardRows,
  boardStages,
  cycleStats,
  histogram,
  rowsFrom,
  scatterPoints,
  sleDays,
  typedRows,
  withinTarget,
} from "./helpers";
import { analyseCycleTimes, trendSentence } from "./analysis";
import { cycleTimeVerdict, daysOrDash } from "./verdict";
import { cycleTimeToMarkdown } from "./markdown";
import { buildExample, type CycleTimeExample } from "./example";
import { StatCard } from "./components/stat-card";
import { HistogramTab } from "./components/histogram-tab";
import { ScatterTab } from "./components/scatter-tab";
import { WorkItemsTable, typedItemRows, type ItemRow } from "./components/work-items-table";
import { AgeingTable } from "./components/ageing-table";
import { AddItemForm } from "./components/add-item-form";
import { StageSection } from "./components/stage-section";

export const TOOL_ID = "cycle-time";

const NO_STORIES: Story[] = [];
const NO_CARDS: KanbanCard[] = [];
const ALL_SOURCES: readonly CycleSource[] = ["story", "card", "typed"];
const FINISHED = ["finished item", "finished items"] as const;
const WEEKS = ["week with a finish", "weeks with a finish"] as const;

const INTERPRETATION: Record<(typeof PERCENTILE_KEYS)[number], string> = {
  50: "Half of items finish within this time",
  75: "Most items finish within this time",
  85: "The usual service-level expectation",
  90: "A high-confidence commitment",
  95: "Near the worst case seen",
};

/**
 * The element whose `data-<name>` is `value`, the one on screen: the table
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
 * Cycle Time Analyzer: how long work takes from start to finish. Finished
 * stories (Sprint board) and cards (Flow board) are read live from their
 * start and done times through lib/flow, with items typed by hand as the
 * fallback; every source counts days the same way (a same-day item is 1).
 * The scatter runs by completion date, the ageing view flags work in
 * progress already older than the 85th percentile, Time in each status
 * reads the boards' recorded moves (with the flow efficiency once the
 * person marks the statuses where work waits), and the statistics wait for
 * enough items, the heavy ones behind Advanced analysis.
 */
export function CycleTimeClient() {
  const hydrated = useWorkspaceHydrated();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const cards = (kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID)?.cards ?? NO_CARDS;
  const {
    items,
    targetPct,
    sleTargetDays,
    waitingStages,
    addItem,
    updateItem,
    setTargetPct,
    setSleTargetDays,
    setWaitingStages,
    reset,
    restoreItems,
  } = useCycleTimeStore();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [sources, setSources] = useState<ReadonlySet<CycleSource>>(() => new Set(ALL_SOURCES));
  // The example lives here only: nothing in it reaches the boards or the store.
  const [example, setExample] = useState<CycleTimeExample | null>(null);
  const preview = example !== null;
  const resetSnapshot = useRef<WorkItem[]>([]);
  const addRef = useRef<HTMLDivElement>(null);
  const pctId = useId();
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  const typedItems = example?.items ?? items;
  const boardStories = preview ? NO_STORIES : stories;
  const boardCards = example?.cards ?? cards;
  // The example marks its own waiting statuses; toggling them changes only its copy.
  const waiting = example?.waiting ?? waitingStages;

  const allRows = useMemo(
    () => [
      ...boardRows(boardStories, boardCards, { includeExamples: preview }),
      ...typedRows(typedItems),
    ],
    [boardStories, boardCards, typedItems, preview]
  );
  const rows = useMemo(() => rowsFrom(allRows, sources), [allRows, sources]);
  const stats = useMemo(() => cycleStats(rows), [rows]);
  const p85 = stats.distributionQuoted ? stats.summary.p85 : null;
  const allAgeing = useMemo(
    () => ageingRows(boardStories, boardCards, today, p85, { includeExamples: preview }),
    [boardStories, boardCards, today, p85, preview]
  );
  const ageing = useMemo(() => allAgeing.filter((a) => sources.has(a.kind)), [allAgeing, sources]);
  const stages = useMemo(
    () => boardStages(boardStories, boardCards, sources, waiting, { includeExamples: preview }),
    [boardStories, boardCards, sources, waiting, preview]
  );
  const typedShown = rows.filter((r) => r.source === "typed").length;
  const showStages = rows.length > typedShown || stages.approximate > 0;
  const sle = { pct: targetPct, days: sleDays(rows, targetPct) };
  const analysis = useMemo(() => analyseCycleTimes(rows), [rows]);
  const verdict = cycleTimeVerdict(stats, ageing, sle);
  const quoted = {
    median: stats.distributionQuoted ? stats.summary.median : null,
    p85,
    p95: stats.percentiles[95],
  };
  const tableRows: ItemRow[] = [
    ...rows.filter((r) => r.source !== "typed").map((r) => ({ key: `${r.source}:${r.id}`, ...r })),
    ...(sources.has("typed") ? typedItemRows(typedItems) : []),
  ];
  const counts = Object.fromEntries(
    ALL_SOURCES.map((s) => [s, allRows.filter((r) => r.source === s).length])
  ) as Record<CycleSource, number>;
  const markdown = cycleTimeToMarkdown({
    today,
    rows,
    sources,
    stats,
    ageing,
    sle,
    ...(showStages ? { stages } : {}),
  });
  // From every source, not the ones picked: switching the only source with
  // data off mustn't swap the page for the first-run state, chips and all.
  const empty = allRows.length === 0 && typedItems.length === 0 && allAgeing.length === 0;

  /* ── Typed items: the store, or the example's copy while it shows ─── */

  const writeTyped = (fn: (list: readonly WorkItem[]) => WorkItem[]) => {
    if (preview) setExample((ex) => (ex ? { ...ex, items: fn(ex.items) } : ex));
    else useCycleTimeStore.setState((s) => ({ items: fn(s.items) }));
  };
  const record: typeof log = preview ? () => undefined : log;

  // The form is hidden while the example shows, so an add is always the user's own.
  const add = (values: Omit<WorkItem, "id">) => {
    addItem(values);
    log(CYCLE_TIME_ACTIONS.ITEM_ADDED, { name: values.name });
    announce(`Added ${values.name}`);
  };
  const rename = (item: WorkItem, name: string) => {
    if (preview) writeTyped((list) => list.map((i) => (i.id === item.id ? { ...i, name } : i)));
    else updateItem(item.id, { name });
    record(CYCLE_TIME_ACTIONS.ITEM_UPDATED, { itemId: item.id, field: "name" });
  };
  const redate = (item: WorkItem, field: "startDate" | "endDate", value: string) => {
    if (preview)
      writeTyped((list) => list.map((i) => (i.id === item.id ? { ...i, [field]: value } : i)));
    else updateItem(item.id, { [field]: value });
    record(CYCLE_TIME_ACTIONS.ITEM_UPDATED, { itemId: item.id, field });
  };
  const remove = (item: WorkItem) => {
    const name = item.name.trim() || "the item";
    // Focus moves on to the next typed item's Delete as the table shows
    // them (else the previous one's), or to the form once none is left.
    const shown = Array.from(
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>("[data-item-delete]")).map(
          (el) => el.dataset.itemDelete ?? ""
        )
      )
    );
    const at = shown.indexOf(item.id);
    const neighbour = at >= 0 ? (shown[at + 1] ?? shown[at - 1]) : undefined;
    removeWithUndo<WorkItem>({
      label: `Deleted “${name}”`,
      update: writeTyped,
      match: (i) => i.id === item.id,
    });
    record(CYCLE_TIME_ACTIONS.ITEM_REMOVED, { itemId: item.id });
    announce(`Deleted ${name}`);
    requestAnimationFrame(() =>
      (neighbour
        ? onScreen("item-delete", neighbour)
        : addRef.current?.querySelector<HTMLElement>("input")
      )?.focus()
    );
  };

  const toggleWaiting = (stage: StageId) => {
    const on = !waiting.includes(stage);
    const next = cleanStageIds(on ? [...waiting, stage] : waiting.filter((s) => s !== stage));
    if (preview) setExample((ex) => (ex ? { ...ex, waiting: next } : ex));
    else setWaitingStages(next);
    announce(`${STAGE_LABEL[stage]} counts as ${on ? "waiting" : "active"}`);
  };

  const toggleSource = (s: CycleSource) => {
    setSources((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const commitTarget = () => {
    if (targetDraft === null) return;
    const n = parseNumber(targetDraft);
    if (n === undefined) {
      setSleTargetDays(null);
      setTargetError(null);
    } else if (!Number.isInteger(n) || n < 1 || n > 365) {
      setTargetError("A target is a whole number of days, from 1 to 365.");
      return;
    } else {
      setSleTargetDays(n);
      setTargetError(null);
    }
    setTargetDraft(null);
  };
  const attained = sleTargetDays !== null ? withinTarget(rows, sleTargetDays) : null;
  const pastTarget =
    sleTargetDays !== null ? ageing.filter((a) => a.ageDays > sleTargetDays).length : 0;

  const promptConfig = useMemo(
    () => ({
      toolName: "Cycle Time Tracker",
      prompts: generateCycleTimePrompts({
        items: rows.map((r) => ({
          name: r.title,
          startDate: r.startedOn,
          endDate: r.doneOn,
          cycleTimeDays: r.days,
          description: SOURCE_LABEL[r.source],
        })),
        stats: {
          mean: stats.summary.average ?? 0,
          median: stats.summary.median ?? 0,
          p85: stats.summary.p85 ?? 0,
          p95: stats.summary.p95 ?? 0,
          stdDev: stats.summary.spread ?? 0,
        },
      }),
    }),
    [rows, stats]
  );

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId={TOOL_ID}
        title="Cycle Time Analyzer"
        description="How long work takes from start to finish, from your boards: set a realistic service level expectation and spot work that's ageing."
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

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Cycle Time Analyzer"
      description="How long work takes from start to finish, from your boards: set a realistic service level expectation and spot work that's ageing."
      category="Metrics & Dashboards"
    >
      <div className="space-y-6">
        {preview && (
          <div>
            <ExampleNotice onClear={() => setExample(null)} />
            <p className="-mt-2 text-xs text-sub">
              Example: seven weeks of a team&apos;s Flow board and two items typed by hand, with
              Review marked as a status where work waits. Nothing in it is saved, and your own
              boards stay as they are.
            </p>
          </div>
        )}

        {empty ? (
          <EmptyState
            icon={Clock}
            action={<LoadExampleButton onLoad={() => setExample(buildExample(today))} />}
          >
            No finished work yet. Stories and cards that reach Done on the{" "}
            <Link href="/kanban" className="font-medium text-accent hover:underline">
              Sprint or Flow board
            </Link>{" "}
            appear here with their cycle times; or type an item below.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm font-medium text-text" aria-live="polite">
              {verdict}
            </p>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p id={`${pctId}-sources`} className="mb-1 text-xs font-medium text-sub">
                  Include
                </p>
                <div
                  role="group"
                  aria-labelledby={`${pctId}-sources`}
                  className="flex flex-wrap gap-1"
                >
                  {ALL_SOURCES.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={sources.has(s) ? "default" : "outline"}
                      aria-pressed={sources.has(s)}
                      onClick={() => toggleSource(s)}
                    >
                      {s === "story"
                        ? "Sprint board stories"
                        : s === "card"
                          ? "Flow board cards"
                          : "Typed"}
                      {/* Read as ", 3 finished", not run into the label ("stories3"). */}
                      <span className="ml-1 font-mono text-xs opacity-80" aria-hidden="true">
                        {counts[s]}
                      </span>
                      <span className="sr-only">, {counts[s]} finished</span>
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="cycle-time"
                  markdown={markdown}
                  clipboardText={markdown}
                  csvData={{
                    headers: ["Item", "Source", "Started", "Finished", "Cycle Time (days)"],
                    rows: rows.map((r) => [
                      r.title,
                      SOURCE_LABEL[r.source],
                      r.startedOn,
                      r.doneOn,
                      r.days,
                    ]),
                  }}
                  jsonData={{
                    items: rows,
                    summary: stats.summary,
                    percentiles: stats.percentiles,
                    ageing,
                    timeInStatus: {
                      stages: stages.stages,
                      flowEfficiency: stages.efficiency,
                      waiting: stages.waiting,
                      items: stages.items,
                    },
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Average"
                value={daysOrDash(stats.summary.average, stats.averageQuoted)}
                unit="days"
                accent
              />
              <StatCard
                label="Median (50th %ile)"
                value={daysOrDash(stats.summary.median, stats.distributionQuoted)}
                unit="days"
              />
              <StatCard
                label="85th percentile"
                value={daysOrDash(stats.summary.p85, stats.distributionQuoted)}
                unit="days"
                accent
              />
              <StatCard
                label="Spread (std dev)"
                value={daysOrDash(stats.summary.spread, stats.distributionQuoted)}
                unit="days"
              />
            </div>
            {stats.summary.count > 0 && !stats.distributionQuoted && (
              <NotEnoughData
                have={stats.summary.count}
                need="distribution"
                unit={FINISHED}
                action="Finish"
                what="the spread, the percentiles and a service-level expectation"
              />
            )}

            {rows.length > 0 && (
              <SectionCard title="Analysis" icon={Clock}>
                <Tabs defaultValue="histogram">
                  <TabsList className="mb-6 border border-border bg-surface-deep">
                    <TabsTrigger value="histogram" className="gap-2">
                      <BarChart3 className="h-4 w-4" aria-hidden="true" />
                      Histogram
                    </TabsTrigger>
                    <TabsTrigger value="scatter" className="gap-2">
                      <Target className="h-4 w-4" aria-hidden="true" />
                      By completion date
                    </TabsTrigger>
                    <TabsTrigger value="sle" className="gap-2">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      SLE
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="histogram">
                    {stats.distributionQuoted ? (
                      <HistogramTab histogramData={histogram(rows)} stats={quoted} />
                    ) : (
                      <NotEnoughData
                        have={stats.summary.count}
                        need="distribution"
                        unit={FINISHED}
                        action="Finish"
                        what="the distribution"
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="scatter">
                    <ScatterTab
                      scatterData={scatterPoints(rows)}
                      stats={quoted}
                      cusumAnnotations={analysis.shifts}
                    />
                  </TabsContent>

                  <TabsContent value="sle">
                    {!stats.distributionQuoted || sle.days === null ? (
                      <NotEnoughData
                        have={stats.summary.count}
                        need="distribution"
                        unit={FINISHED}
                        action="Finish"
                        what="a service-level expectation"
                      />
                    ) : (
                      <div className="space-y-6">
                        <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 text-center">
                          <p className="mb-1 text-sm text-sub">Service level expectation</p>
                          <p className="text-2xl font-data font-bold text-text">
                            <span className="text-accent">{sle.pct}%</span> of items finish within{" "}
                            <span className="text-accent-green">{sle.days} days</span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-start gap-4">
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={pctId} className="text-sm text-text">
                              Stated at
                            </label>
                            <select
                              id={pctId}
                              value={targetPct}
                              onChange={(e) =>
                                setTargetPct(Number(e.target.value) as SlePercentile)
                              }
                              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {SLE_PERCENTILES.map((p) => (
                                <option key={p} value={p}>
                                  {p}th percentile
                                </option>
                              ))}
                            </select>
                          </div>
                          <Field
                            label="Target (days)"
                            hint="Optional: a target to check finished and ageing work against."
                            error={targetError}
                            className="w-56"
                          >
                            {(p) => (
                              <Input
                                {...p}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                placeholder={sle.days !== null ? `e.g. ${sle.days}` : "e.g. 7"}
                                value={
                                  targetDraft ??
                                  (sleTargetDays !== null ? String(sleTargetDays) : "")
                                }
                                onChange={(e) => setTargetDraft(e.target.value)}
                                onBlur={commitTarget}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                }}
                              />
                            )}
                          </Field>
                        </div>
                        {attained && sleTargetDays !== null && (
                          <p className="text-sm text-text">
                            {attained.within} of {attained.total} finished items (
                            {fmt(attained.pct ?? 0, 0)}%) made it within {sleTargetDays} days
                            {pastTarget > 0
                              ? `; ${pastTarget === 1 ? "1 item" : `${pastTarget} items`} in progress ${
                                  pastTarget === 1 ? "is" : "are"
                                } already older than that.`
                              : "."}
                          </p>
                        )}

                        <div className="relative overflow-x-auto rounded-lg border border-border">
                          <table className="w-full text-sm">
                            <caption className="sr-only">Cycle time at each percentile</caption>
                            <thead>
                              <tr className="border-b border-border bg-surface-deep text-xs uppercase tracking-wider text-sub">
                                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                                  Percentile
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                                  Cycle time
                                </th>
                                <th
                                  scope="col"
                                  className="hidden px-4 py-2.5 text-left font-medium sm:table-cell"
                                >
                                  Meaning
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {PERCENTILE_KEYS.map((p) => (
                                <tr
                                  key={p}
                                  className={cn(
                                    "border-b border-border last:border-0",
                                    p === targetPct && "bg-accent/5"
                                  )}
                                >
                                  <th
                                    scope="row"
                                    className="px-4 py-2.5 text-left font-data font-normal text-text"
                                  >
                                    {p}th
                                    {p === targetPct && (
                                      <span className="ml-2 text-xs text-accent">(SLE)</span>
                                    )}
                                  </th>
                                  <td className="px-4 py-2.5 text-right font-data font-bold text-text">
                                    {stats.percentiles[p] ?? "—"} days
                                  </td>
                                  <td className="hidden px-4 py-2.5 text-xs text-sub sm:table-cell">
                                    {INTERPRETATION[p]}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </SectionCard>
            )}

            {ageing.length > 0 && (
              <SectionCard title="Ageing work in progress" icon={Hourglass}>
                <p className="mb-3 text-xs text-sub">
                  {p85 !== null
                    ? `In progress or in review, oldest first. Tinted: older than the 85th percentile (${p85} days), so likely to miss it.`
                    : `In progress or in review, oldest first. Ages are checked against the 85th percentile once ${MIN_SAMPLE.distribution} items have finished.`}
                </p>
                <AgeingTable items={ageing} sleDays={p85} preview={preview} />
              </SectionCard>
            )}

            {showStages && (
              <StageSection
                breakdown={stages}
                onToggleWaiting={toggleWaiting}
                typedLeftOut={typedShown}
              />
            )}

            {rows.length > 0 && (
              <AdvancedAnalysis summary="Advanced analysis: confidence ranges, change points and trend">
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text">
                    How sure are the median and the 85th percentile?
                  </h3>
                  {analysis.p50Range && analysis.p85Range ? (
                    <p className="text-sm text-text">
                      Resampling the {stats.summary.count} items, the median is likely between{" "}
                      {fmt(analysis.p50Range.lower)} and {fmt(analysis.p50Range.upper)} days and the
                      85th percentile between {fmt(analysis.p85Range.lower)} and{" "}
                      {fmt(analysis.p85Range.upper)} days (95% bootstrap ranges).
                    </p>
                  ) : (
                    <NotEnoughData
                      have={stats.summary.count}
                      need="distribution"
                      unit={FINISHED}
                      action="Finish"
                      what="confidence ranges"
                    />
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text">Change points</h3>
                  {stats.summary.count >= MIN_SAMPLE.changePoint ? (
                    <p className="text-sm text-text">
                      {analysis.shifts.length === 0
                        ? "No sustained shift in cycle time, in order of completion."
                        : `${analysis.shifts.map((s) => s.detail).join(" ")} Marked on the By completion date chart.`}
                    </p>
                  ) : (
                    <NotEnoughData
                      have={stats.summary.count}
                      need="changePoint"
                      unit={FINISHED}
                      action="Finish"
                      what="change points"
                    />
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text">Weekly trend</h3>
                  {analysis.trend ? (
                    <p className="text-sm text-text">{trendSentence(analysis.trend)}</p>
                  ) : (
                    <NotEnoughData
                      have={analysis.weeks}
                      need="trend"
                      unit={WEEKS}
                      action="Wait for"
                      what="a trend test"
                    />
                  )}
                </section>
              </AdvancedAnalysis>
            )}

            {tableRows.length > 0 && (
              <SectionCard title="Finished items" icon={ListChecks}>
                <WorkItemsTable
                  rows={tableRows}
                  today={today}
                  onRename={rename}
                  onDate={redate}
                  onRemove={remove}
                />
              </SectionCard>
            )}
          </>
        )}

        {/* Not while the example shows: an item typed in would go with Clear example. */}
        {!preview && (
          <SectionCard
            title="Type an item"
            icon={Keyboard}
            actions={
              items.length > 0 ? (
                <ResetButton
                  label="Clear typed items"
                  title="Clear every typed item?"
                  description={`All ${items.length} items you typed go; stories and cards on the boards stay. You can undo this for a few seconds.`}
                  confirmLabel="Clear typed items"
                  doneLabel="Cleared the typed items"
                  onReset={() => {
                    resetSnapshot.current = useCycleTimeStore.getState().items;
                    reset();
                    log(CYCLE_TIME_ACTIONS.CYCLE_TIME_RESET, {
                      items: resetSnapshot.current.length,
                    });
                  }}
                  onUndo={() => restoreItems(resetSnapshot.current)}
                />
              ) : undefined
            }
          >
            <p className="mb-3 text-xs text-sub">
              For work tracked somewhere the toolkit can&apos;t read. Stories and cards on the
              boards are counted on their own.
            </p>
            <div ref={addRef}>
              <AddItemForm today={today} onAdd={add} />
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
