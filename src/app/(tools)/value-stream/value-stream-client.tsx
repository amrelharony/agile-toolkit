"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/motion/transition-link";
import { nanoid } from "nanoid";
import { ArrowRight, Copy, GitCompareArrows, Plus, Waves } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ResetButton } from "@/components/shared/reset-button";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { generateValueStreamPrompts } from "@/lib/ai-prompts/value-stream";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type RetroBoard,
  type ValueStreamStage,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VALUE_STREAM_ACTIONS } from "@/lib/history/event-actions";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import { cardItems, recentMoves, storyItems } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import { fmt } from "@/lib/charts/chart-text";
import { ragTone } from "@/lib/utils/rag-tone";
import { undoable, removeWithUndo } from "@/lib/utils/undoable";
import type { HandoffLink } from "@/lib/handoffs/types";
import {
  STATE_LABEL,
  VALUE_STREAM_STATES,
  appendStage,
  bottleneck,
  changedStages,
  compareStates,
  comparisonVerdict,
  copyToFuture,
  headlineVerdict,
  leadOf,
  moveStage,
  orderKnown,
  orderedStages,
  pinOrder,
  processOf,
  stageState,
  vsmSummary,
  waitOf,
  type ValueStreamState,
} from "@/lib/value-stream/summary";
import { AddStageForm } from "./add-stage-form";
import { StageCard } from "./stage-card";
import { buildExample } from "./example";
import { comparisonRows, stageBars, stageChartText, type ComparisonRow } from "./chart-text";
import { valueStreamToMarkdown } from "./markdown";
import type { StageValues } from "./form";

export const TOOL_ID = "value-stream";

// Recharts loads with the chart, not the page.
const StageTimesChart = dynamic(() => import("./charts").then((m) => m.StageTimesChart), {
  ssr: false,
  loading: () => (
    <div className="h-40 w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

const NO_STAGES: ValueStreamStage[] = [];
const NO_RETROS: RetroBoard[] = [];

/** A change to the whole list of stages; the writer works out the rows to save. */
type StagesUpdate = (list: readonly ValueStreamStage[]) => ValueStreamStage[];
type Write = (update: StagesUpdate) => void;

/**
 * Writes to the workspace (the rows agents, sync and other devices read):
 * the stages the update dropped are removed, and those it added or changed
 * are upserted one by one, so a concurrent change to another stage stays.
 */
const writeStore: Write = (update) => {
  const ws = useWorkspaceStore.getState();
  const before = ws.valueStreamStages ?? [];
  const after = update(before);
  const kept = new Set(after.map((s) => s.id));
  for (const s of before) if (!kept.has(s.id)) ws.removeValueStreamStage(s.id);
  for (const s of changedStages(before, after)) ws.upsertValueStreamStage(s);
};

/** A map toggle's count, read as ", 5 stages" rather than run into the label ("Current state5"). */
function MapCount({ n }: { n: number }) {
  return (
    <>
      <span className="ml-1 font-mono text-xs opacity-80" aria-hidden="true">
        {n}
      </span>
      <span className="sr-only">, {n === 1 ? "1 stage" : `${n} stages`}</span>
    </>
  );
}

/** The element whose `data-<name>` is `value`; ids go in no selector, so need no escaping. */
function byData(name: string, value: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-${name}]`)).find(
    (el) => el.getAttribute(`data-${name}`) === value
  );
}

/**
 * Focus what `find` returns once React has re-rendered. Deleting a stage,
 * keeping a map's order or starting the future state unmounts the control
 * that had focus, and focus would otherwise drop to <body>.
 */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/**
 * After a move, keep focus on the moved stage's arrow (focusing it scrolls
 * its card into view in the sideways list); at either end that arrow is
 * disabled, so focus its other one.
 */
function focusMoved(id: string, delta: -1 | 1) {
  const arrow = (d: -1 | 1) =>
    byData("stage-move", `${id}:${d === -1 ? "earlier" : "later"}`) as
      | HTMLButtonElement
      | undefined;
  focusSoon(() => {
    const el = arrow(delta);
    return el && !el.disabled ? el : arrow(delta === -1 ? 1 : -1);
  });
}

/**
 * Where a stage was sent as a retro topic: the cards on the current retro
 * that came from it. Read from the board, since a stage keeps no links of
 * its own, so "Sent · Open" survives a reload and Undo of the send.
 */
function retroLinks(boards: readonly RetroBoard[], stageId: string): HandoffLink[] {
  const board = boards.find((b) => b.id === RETRO_CURRENT_ID);
  return (
    (board?.cards ?? [])
      .filter((c) => c.sourceRef?.tool === TOOL_ID && c.sourceRef.id === stageId)
      // The card keeps no send time; the link's `at` isn't shown.
      .map((c) => ({ route: "retro-topic", targetId: c.id, at: "" }))
  );
}

const COMPARISON_COLUMNS: DataTableColumn<ComparisonRow>[] = [
  { key: "measure", header: "Measure", primary: true, cell: (r) => r.measure },
  { key: "current", header: "Current", align: "right", cell: (r) => r.current },
  { key: "future", header: "Future", align: "right", cell: (r) => r.future },
  {
    key: "change",
    header: "Change",
    align: "right",
    cell: (r) => (
      <span className={r.better === null ? "text-sub" : r.better ? "text-success" : "text-warning"}>
        {r.change}
      </span>
    ),
  },
];

/**
 * Value Stream Map: the stages work goes through, with how long each takes
 * (process) and how long work sits there in all (lead), in order. The
 * bottleneck (the longest wait) is marked, the stages can be reordered,
 * and a future state can be drafted from the current one and compared
 * with it. The stages live in the workspace, so tool.value_stream.* reads
 * and writes the same map, through the same lib/value-stream/summary.
 */
export function ValueStreamClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.valueStreamStages) ?? NO_STAGES;
  const stories = useWorkspaceStore((s) => s.stories);
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_RETROS;
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [view, setView] = useState<ValueStreamState>("current");
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<ValueStreamStage[] | null>(null);
  // The map a Clear took away, for its Undo.
  const cleared = useRef<ValueStreamStage[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const preview = example !== null;
  const stages = example ?? stored;

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const writeExample: Write = (update) => setExample((ex) => (ex ? update(ex) : ex));
  const write = preview ? writeExample : writeStore;
  const record: typeof log = preview ? () => undefined : log;
  const newId = () => (preview ? exampleId(`vsm-${nanoid(6)}`) : `vsstage_${nanoid(8)}`);

  const current = useMemo(() => orderedStages(stages, "current"), [stages]);
  const future = useMemo(() => orderedStages(stages, "future"), [stages]);
  const shown = view === "current" ? current : future;
  const summary = vsmSummary(shown);
  const neck = bottleneck(shown);
  // The retro hand-off is about the map as it is today, never the planned one.
  const currentNeck = bottleneck(current);
  const comparison = compareStates(current, future);
  const compared = comparisonVerdict(comparison);
  const verdict = headlineVerdict(current, future);
  const mapLabel = STATE_LABEL[view].toLowerCase();
  const chart = stageChartText(shown, STATE_LABEL[view]);
  const markdown = valueStreamToMarkdown(stages, today);

  // Board activity since the stage times were typed: read after hydration
  // (the boards are persisted, so the first render can't know them).
  const moved = useMemo(() => {
    if (!hydrated) return 0;
    const board = (kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID);
    return recentMoves([...storyItems(stories ?? []), ...cardItems(board?.cards ?? [])], today, 7);
  }, [hydrated, stories, kanbanBoards, today]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Value Stream Map",
      prompts: generateValueStreamPrompts({
        stages: current.map((s) => ({
          name: s.name,
          processTime: processOf(s),
          leadTime: leadOf(s),
          completeAccurate: s.completeAccurate,
        })),
        totalProcess: vsmSummary(current).totalProcess,
        totalLead: vsmSummary(current).totalLead,
        flowEfficiency: vsmSummary(current).flowEfficiency ?? 0,
        rolledCA: vsmSummary(current).rolledCA ?? 0,
      }),
    }),
    [current]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  const add = (values: StageValues) => {
    const stage: ValueStreamStage = { id: newId(), ...values, state: view };
    write((list) => appendStage(list, stage));
    record(VALUE_STREAM_ACTIONS.STAGE_ADDED, { stageId: stage.id, name: stage.name, state: view });
    announce(`Added ${stage.name} to the ${mapLabel}`);
  };

  const update = (stage: ValueStreamStage, patch: Partial<ValueStreamStage>, field: string) => {
    write((list) => list.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)));
    record(VALUE_STREAM_ACTIONS.STAGE_UPDATED, { stageId: stage.id, field });
  };

  const move = (stage: ValueStreamStage, index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= shown.length) return;
    write((list) => moveStage(list, stage.id, to));
    record(VALUE_STREAM_ACTIONS.STAGE_MOVED, { stageId: stage.id, from: index, to });
    announce(`Moved ${stage.name.trim() || "the stage"} to position ${to + 1} of ${shown.length}`);
    focusMoved(stage.id, delta);
  };

  /** The first stage card's name field: where focus goes when the control that had it is gone. */
  const firstStageField = () => listRef.current?.querySelector<HTMLElement>("input");

  /**
   * Number a map saved before stages kept a position, in the order shown
   * here: asked of the person looking at it, since a device that pulled
   * the rows got them by id and can't know the order they were built in.
   */
  const keepOrder = () => {
    write((list) => pinOrder(list, view));
    announce(`Kept this order of the ${mapLabel} for every device`);
    focusSoon(firstStageField);
  };

  const remove = (stage: ValueStreamStage) => {
    const name = stage.name.trim() || "Unnamed stage";
    // Focus moves on to the next stage's Delete (else the previous one's),
    // or to the Add stage form once the map is empty.
    const at = shown.findIndex((s) => s.id === stage.id);
    const neighbour = at >= 0 ? (shown[at + 1] ?? shown[at - 1]) : undefined;
    removeWithUndo<ValueStreamStage>({
      label: `Deleted “${name}”`,
      update: write,
      match: (s) => s.id === stage.id,
    });
    record(VALUE_STREAM_ACTIONS.STAGE_REMOVED, { stageId: stage.id, name: stage.name });
    announce(`Deleted ${name}`);
    focusSoon(() =>
      neighbour
        ? byData("stage-delete", neighbour.id)
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  };

  const startFuture = () => {
    const copies = copyToFuture(stages, newId);
    if (copies.length === 0) return;
    const ids = new Set(copies.map((s) => s.id));
    undoable({
      label: "Started the future state from the current one",
      apply: () => write((list) => [...list, ...copies]),
      revert: () => write((list) => list.filter((s) => !ids.has(s.id))),
    });
    record(VALUE_STREAM_ACTIONS.FUTURE_STATE_STARTED, { stages: copies.length });
    setView("future");
    announce(`Copied ${copies.length} stages into the future state`);
    // The button goes once the copies land: focus the first future stage.
    focusSoon(firstStageField);
  };

  /** Clear one map; Undo puts its stages back as they were. */
  const resetMap = () => {
    const state = view;
    cleared.current = stages.filter((s) => stageState(s) === state);
    write((list) => list.filter((s) => stageState(s) !== state));
    record(VALUE_STREAM_ACTIONS.VALUE_STREAM_RESET, { state, stages: cleared.current.length });
  };
  const undoReset = () => {
    const back = cleared.current;
    const ids = new Set(back.map((s) => s.id));
    write((list) => [...list.filter((s) => !ids.has(s.id)), ...back]);
  };

  const loadExample = () => {
    setExample(buildExample());
    setView("current");
  };
  const clearExample = () => {
    setExample(null);
    setView("current");
  };

  const empty = current.length === 0 && future.length === 0;

  // The workspace loads after the first paint: until then "No stages yet"
  // and Load example would flash for someone who has a map.
  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId={TOOL_ID}
        title="Value Stream Map"
        description="Map your process stages with lead time, process time, and %C/A. Auto-computes flow efficiency."
        category="Flow & Delivery"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the map…
        </p>
      </ToolPageWrapper>
    );
  }

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Value Stream Map"
      description="Map your process stages with lead time, process time, and %C/A. Auto-computes flow efficiency."
      category="Flow & Delivery"
    >
      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: a web team&apos;s map from idea to production, now and as they want it. Nothing
            in it is saved.
          </p>
        </div>
      )}

      {empty ? (
        <EmptyState icon={Waves} action={<LoadExampleButton onLoad={loadExample} />}>
          No stages yet. Add the first stage work goes through below, then the next, in order.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium text-text">{verdict}</p>
          {compared && <p className="text-sm text-sub">{compared}</p>}

          {!preview && moved > 0 && (
            <p>
              <Link
                href="/kanban"
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/5 px-2.5 py-1 text-xs text-accent no-underline hover:bg-accent/10"
              >
                {moved === 1 ? "1 item" : `${moved} items`} moved on the boards in the last 7 days:
                check the stage times still match
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </p>
          )}

          <ActionRow>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="value-stream"
              markdown={markdown}
              clipboardText={markdown}
              csvData={{
                headers: [
                  "State",
                  "Order",
                  "Stage",
                  "Description",
                  "Process Time",
                  "Wait Time",
                  "Lead Time",
                  "%C/A",
                ],
                rows: [...current, ...future].map((s, i) => [
                  stageState(s),
                  (stageState(s) === "current" ? i : i - current.length) + 1,
                  s.name,
                  s.description ?? "",
                  processOf(s),
                  waitOf(s),
                  leadOf(s),
                  s.completeAccurate,
                ]),
              }}
              jsonData={[...current, ...future]}
            />
          </ActionRow>
        </div>
      )}

      {!empty && (
        // Toggle buttons, not tabs: the cards, chart and form below all
        // follow the map picked, so there is no one panel a tab could own.
        <div role="group" aria-label="Which map" className="mt-4 flex flex-wrap gap-1">
          {VALUE_STREAM_STATES.map((state) => (
            <Button
              key={state}
              type="button"
              size="sm"
              variant={view === state ? "default" : "outline"}
              aria-pressed={view === state}
              onClick={() => setView(state)}
            >
              {STATE_LABEL[state]}
              <MapCount n={state === "current" ? current.length : future.length} />
            </Button>
          ))}
        </div>
      )}

      {!empty && shown.length === 0 && view === "future" && (
        <EmptyState
          icon={GitCompareArrows}
          padding="md"
          className="mt-4"
          action={
            current.length > 0 ? (
              <Button type="button" size="sm" onClick={startFuture} className="gap-1.5">
                <Copy aria-hidden="true" />
                Start the future state from the current one
              </Button>
            ) : undefined
          }
        >
          No future state yet. Copy the current map and change it to the flow you want, or add its
          stages below.
        </EmptyState>
      )}

      {shown.length > 0 && (
        <div className="mt-4 space-y-4">
          <KpiGrid cols={4} gap="lg">
            <StatCard variant="compact" label="Lead time" value={`${fmt(summary.totalLead)}d`} />
            <StatCard
              variant="compact"
              label="Process time"
              value={`${fmt(summary.totalProcess)}d`}
            />
            <StatCard
              variant="compact"
              label="Flow efficiency"
              value={summary.flowEfficiency === null ? "—" : `${fmt(summary.flowEfficiency, 0)}%`}
              valueClassName={
                summary.flowEfficiency === null
                  ? undefined
                  : ragTone(summary.flowEfficiency, { good: 40, warn: 15 })
              }
            />
            <StatCard
              variant="compact"
              label="Rolled %C/A"
              value={summary.rolledCA === null ? "—" : `${fmt(summary.rolledCA, 0)}%`}
              valueClassName={
                summary.rolledCA === null
                  ? undefined
                  : ragTone(summary.rolledCA, { good: 80, warn: 60 })
              }
            />
          </KpiGrid>

          {!preview && shown.length >= 2 && !orderKnown(stages, view) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-sub">
              <span>
                These stages were saved before the map kept its order across devices, so another
                device may list them differently. If this order is right, keep it.
              </span>
              <Button type="button" size="sm" variant="outline" onClick={keepOrder}>
                Keep this order
              </Button>
            </div>
          )}

          <ul
            ref={listRef}
            aria-label={`${STATE_LABEL[view]} stages, in order`}
            className="scroll-x-snap items-stretch pb-4"
          >
            {shown.map((s, i) => (
              <Fragment key={s.id}>
                <li className="w-[80vw] max-w-[16rem] md:w-56">
                  <StageCard
                    stage={s}
                    index={i}
                    count={shown.length}
                    bottleneck={neck}
                    onRename={(name) => update(s, { name }, "name")}
                    onDescription={(description) => update(s, { description }, "description")}
                    onNumber={(field, n) => update(s, { [field]: n }, field)}
                    onMove={(delta) => move(s, i, delta)}
                    onDelete={() => remove(s)}
                  />
                </li>
                {i < shown.length - 1 && (
                  <li aria-hidden="true" className="flex items-center text-accent">
                    <ArrowRight className="h-4 w-4" />
                  </li>
                )}
              </Fragment>
            ))}
          </ul>

          {view === "current" && currentNeck && !preview && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-sub">
              <span>
                Take the {currentNeck.stage.name.trim() || "bottleneck"} wait to the team&apos;s
                next retro:
              </span>
              <SendToMenu
                routes={["retro-topic"]}
                item={{
                  title: `Work waits ${fmt(currentNeck.waitDays)} days in ${
                    currentNeck.stage.name.trim() || "one stage"
                  } (${fmt(currentNeck.sharePct, 0)}% of our lead time)`,
                  description: verdict,
                  sourceRef: { tool: TOOL_ID, id: currentNeck.stage.id },
                }}
                sentTo={retroLinks(retroBoards, currentNeck.stage.id)}
                getLinks={() =>
                  retroLinks(useWorkspaceStore.getState().retroBoards ?? [], currentNeck.stage.id)
                }
                // The links are read back from the retro board, so there is nothing to store.
                onLinksChange={() => undefined}
              />
            </div>
          )}

          <SectionCard title="Where the time goes" icon={Waves}>
            <ChartFigure
              label={`${STATE_LABEL[view]}: work and wait per stage`}
              summary={chart.summary}
              table={chart.table}
            >
              <StageTimesChart data={stageBars(shown)} />
            </ChartFigure>
          </SectionCard>
        </div>
      )}

      {comparison && current.length > 0 && (
        <SectionCard title="Current vs future" icon={GitCompareArrows} className="mt-4">
          <DataTable
            columns={COMPARISON_COLUMNS}
            rows={comparisonRows(comparison)}
            rowKey={(r) => r.key}
          />
        </SectionCard>
      )}

      {/* Not while the example shows: a stage typed into it would go with Clear example. */}
      {!preview && (
        <SectionCard
          title={`Add a stage to the ${mapLabel}`}
          icon={Plus}
          className="mt-4"
          actions={
            shown.length > 0 ? (
              <ResetButton
                label={view === "current" ? "Clear the current state" : "Clear the future state"}
                title={`Clear the ${mapLabel}?`}
                description={`All ${shown.length} of its stages go${
                  view === "current" && future.length > 0 ? "; the future state stays" : ""
                }. You can undo this for a few seconds.`}
                confirmLabel="Clear stages"
                doneLabel={`Cleared the ${mapLabel}`}
                onReset={resetMap}
                onUndo={undoReset}
              />
            ) : undefined
          }
        >
          <div ref={addRef}>
            <AddStageForm mapLabel={mapLabel} onAdd={add} />
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}
