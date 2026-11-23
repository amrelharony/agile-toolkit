"use client";

/**
 * Flow Insights: the kinds of work a team finishes (features, defects, debt,
 * risk) against the mix it aims for, how much of it is repeat work caused by
 * an earlier failure, and how stable the team has been.
 *
 * It keeps no record of its own: it reads the stories, sprints, the Flow
 * board, capacity plans and the workflow definition live (lib/flow
 * distribution and stability, which Amr's tool.flow_insights verbs read
 * too), and writes only a story's or a card's `workType` / `demand` and the
 * target mix (shared with Kanban's Definition of Workflow). The example is
 * held in memory and never reaches the workspace. View choices (board,
 * window) are this browser's own prefs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChartColumnStacked } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Field } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { generateFlowInsightsPrompts } from "@/lib/ai-prompts/flow-insights";
import type { AiSource } from "@/lib/ai/task-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { BLOCK_TRACKING_SINCE } from "@/lib/flow/block-stamps";
import {
  SPRINT_WINDOWS,
  WEEK_WINDOWS,
  defaultBoard,
  flowInsights,
  unsortedItems,
  type FlowBoard,
  type MixItem,
  type SprintWindow,
  type WeekWindow,
} from "@/lib/flow/distribution";
import {
  WORK_TYPE_LABEL,
  targetSplitOf,
  withTargetSplit,
  type TargetSplit,
} from "@/lib/flow/work-types";
import { FLOW_INSIGHTS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  WORKFLOW_DEFINITION_ID,
  type CapacityPlan,
  type KanbanBoard,
  type Sprint,
  type Story,
  type WorkType,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { isExampleId } from "@/lib/utils/example-id";
import { undoable } from "@/lib/utils/undoable";
import { FailureSection } from "./components/failure-section";
import { MixSection } from "./components/mix-section";
import { SortSection, suggestionChange, type SortSuggestion } from "./components/sort-section";
import { StabilitySection } from "./components/stability-section";
import { buildExample } from "./example";
import { toMarkdown, dateLabel } from "./markdown";
import { typeWrite, undoChanges, type FlowData, type TypeChange } from "./model";
import { DEFAULT_PREFS, normalizePrefs, useFlowInsightsPrefs } from "./store";

const NO_STORIES: Story[] = [];
const NO_SPRINTS: Sprint[] = [];
const NO_BOARDS: KanbanBoard[] = [];
const NO_PLANS: CapacityPlan[] = [];
const NO_DEFS: WorkflowDefinition[] = [];

/** Where the page's writes go: the workspace, or the example in memory. */
interface FlowWriter {
  read: () => FlowData;
  putStories: (rows: Story[]) => void;
  putBoard: (board: KanbanBoard) => void;
  putWorkflow: (def: WorkflowDefinition) => void;
}

function dataOf(s: {
  stories?: Story[];
  sprints?: Sprint[];
  kanbanBoards?: KanbanBoard[];
  capacityPlans?: CapacityPlan[];
  workflowDefinitions?: WorkflowDefinition[];
}): FlowData {
  return {
    stories: s.stories ?? NO_STORIES,
    sprints: s.sprints ?? NO_SPRINTS,
    board: (s.kanbanBoards ?? NO_BOARDS).find((b) => b.id === KANBAN_BOARD_ID) ?? null,
    plans: s.capacityPlans ?? NO_PLANS,
    workflow:
      (s.workflowDefinitions ?? NO_DEFS).find((d) => d.id === WORKFLOW_DEFINITION_ID) ?? null,
  };
}

const liveWriter: FlowWriter = {
  read: () => dataOf(useWorkspaceStore.getState()),
  // One write for the lot: each store write saves the whole workspace.
  putStories: (rows) => {
    if (rows.length > 0) useWorkspaceStore.getState().bulkUpsertStories(rows);
  },
  putBoard: (board) => useWorkspaceStore.getState().upsertKanbanBoard(board),
  putWorkflow: (def) => useWorkspaceStore.getState().upsertWorkflowDefinition(def),
};

/** Whether anything has finished on either board (examples aside). */
function anyFinished(d: FlowData, includeExamples: boolean): boolean {
  const real = (id: string) => includeExamples || !isExampleId(id);
  return (
    d.stories.some((s) => s && s.status === "done" && real(s.id)) ||
    (d.board?.cards ?? []).some((c) => c && c.column === "done" && real(c.id))
  );
}

const sameSplit = (a: TargetSplit | null, b: TargetSplit | null) =>
  JSON.stringify(a) === JSON.stringify(b);

const short = (t: string, max = 40) => {
  const s = t.replace(/\s+/g, " ").trim() || "Untitled";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export function FlowInsightsClient() {
  return (
    <ToolPageWrapper
      toolId="flow-insights"
      title="Flow Insights"
      description="The mix of work you finish against your target, the repeat work, and how stable the team is."
    >
      <FlowInsightsBody />
    </ToolPageWrapper>
  );
}

function FlowInsightsBody() {
  const hydrated = useWorkspaceHydrated();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards) ?? NO_BOARDS;
  const capacityPlans = useWorkspaceStore((s) => s.capacityPlans) ?? NO_PLANS;
  const workflowDefinitions = useWorkspaceStore((s) => s.workflowDefinitions) ?? NO_DEFS;
  const live = useMemo(
    () => dataOf({ stories, sprints, kanbanBoards, capacityPlans, workflowDefinitions }),
    [stories, sprints, kanbanBoards, capacityPlans, workflowDefinitions]
  );

  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    void Promise.resolve(useFlowInsightsPrefs.persist.rehydrate()).then(() => setPrefsReady(true));
  }, []);
  const rawBoard = useFlowInsightsPrefs((s) => s.board);
  const rawSprintWindow = useFlowInsightsPrefs((s) => s.sprintWindow);
  const rawWeekWindow = useFlowInsightsPrefs((s) => s.weekWindow);
  const prefs = prefsReady
    ? normalizePrefs({ board: rawBoard, sprintWindow: rawSprintWindow, weekWindow: rawWeekWindow })
    : DEFAULT_PREFS;

  const [example, setExampleState] = useState<FlowData | null>(null);
  const exampleRef = useRef<FlowData | null>(null);
  const setExample = useCallback((next: FlowData | null) => {
    exampleRef.current = next;
    setExampleState(next);
  }, []);
  const { log } = useHistoryLogger("flow-insights");
  const [status, setStatus] = useState("");
  const [today] = useState(() => todayIso());
  const [now] = useState(() => Date.now());

  // Writes to the example go to its in-memory copy; a write after it was
  // cleared (an Undo) does nothing.
  const exampleWriter = useMemo<FlowWriter>(() => {
    const update = (patch: (d: FlowData) => FlowData) => {
      const cur = exampleRef.current;
      if (cur) setExample(patch(cur));
    };
    return {
      read: () => exampleRef.current ?? dataOf({}),
      putStories: (rows) =>
        update((d) => {
          const byId = new Map(rows.map((r) => [r.id, r]));
          return { ...d, stories: d.stories.map((s) => byId.get(s.id) ?? s) };
        }),
      putBoard: (board) => update((d) => ({ ...d, board })),
      putWorkflow: (def) => update((d) => ({ ...d, workflow: def })),
    };
  }, [setExample]);
  const writer = example ? exampleWriter : liveWriter;

  const data = example ?? live;
  const includeExamples = example !== null;
  const board: FlowBoard =
    prefs.board ?? defaultBoard({ ...data, cards: data.board?.cards ?? [], includeExamples });
  const periods = board === "sprint" ? prefs.sprintWindow : prefs.weekWindow;
  const x = useMemo(
    () =>
      flowInsights({
        board,
        stories: data.stories,
        sprints: data.sprints,
        cards: data.board?.cards ?? [],
        plans: data.plans,
        workflow: data.workflow,
        periods,
        today,
        now,
        includeExamples,
      }),
    [board, data, periods, today, now, includeExamples]
  );
  const unsorted = useMemo(() => unsortedItems(x.periods), [x.periods]);

  /* ── Writes ── */

  /** Write `changes` with one Undo; returns how many rows changed. */
  function writeTypes(changes: TypeChange[], label: string): number {
    const cur = writer.read();
    const w = typeWrite(cur.stories, cur.board, changes);
    if (w.before.length === 0) return 0;
    undoable({
      label,
      kind: "success",
      apply: () => {
        writer.putStories(w.stories);
        if (w.board) writer.putBoard(w.board);
      },
      revert: () => {
        const back = writer.read();
        const undo = typeWrite(
          back.stories,
          back.board,
          undoChanges(w.before, back.stories, back.board)
        );
        writer.putStories(undo.stories);
        if (undo.board) writer.putBoard(undo.board);
      },
    });
    return w.before.length;
  }

  function setType(item: MixItem, type: WorkType) {
    const n = writeTypes(
      [{ kind: item.kind, id: item.id, type }],
      `“${short(item.title)}” is now ${WORK_TYPE_LABEL[type].toLowerCase()}`
    );
    if (n === 0) return;
    if (!example) log(FLOW_INSIGHTS_ACTIONS.WORK_TYPE_SET, { id: item.id, kind: item.kind, type });
    setStatus(`Sorted “${short(item.title)}” as ${WORK_TYPE_LABEL[type].toLowerCase()}.`);
  }

  function toggleRepeat(item: MixItem) {
    const demand = item.failure ? "value" : "failure";
    const n = writeTypes(
      [{ kind: item.kind, id: item.id, demand }],
      item.failure
        ? `“${short(item.title)}” is no longer repeat work`
        : `“${short(item.title)}” is repeat work`
    );
    if (n === 0) return;
    if (!example)
      log(FLOW_INSIGHTS_ACTIONS.WORK_TYPE_SET, { id: item.id, kind: item.kind, demand });
    setStatus(
      item.failure
        ? `“${short(item.title)}” no longer counts as repeat work.`
        : `“${short(item.title)}” counts as repeat work.`
    );
  }

  function acceptMany(changes: TypeChange[], source: "guesses" | AiSource) {
    const n = writeTypes(
      changes,
      `Sorted ${changes.length} ${changes.length === 1 ? "item" : "items"}`
    );
    if (n === 0) return;
    if (!example) log(FLOW_INSIGHTS_ACTIONS.WORK_TYPES_SORTED, { count: n, source });
    setStatus(`Sorted ${n} ${n === 1 ? "item" : "items"}.`);
  }

  const acceptGuesses = (items: MixItem[]) =>
    acceptMany(
      items.flatMap((it) => (it.type ? [{ kind: it.kind, id: it.id, type: it.type }] : [])),
      "guesses"
    );

  const acceptSuggestions = (list: SortSuggestion[], source: AiSource) => {
    if (list.length === 1) {
      const s = list[0];
      const n = writeTypes(
        [suggestionChange(s)],
        `“${short(s.title)}” is now ${WORK_TYPE_LABEL[s.type].toLowerCase()}`
      );
      if (n > 0 && !example) {
        log(FLOW_INSIGHTS_ACTIONS.WORK_TYPE_SET, { id: s.id, kind: s.kind, type: s.type, source });
      }
      if (n > 0)
        setStatus(`Sorted “${short(s.title)}” as ${WORK_TYPE_LABEL[s.type].toLowerCase()}.`);
      return;
    }
    acceptMany(list.map(suggestionChange), source);
  };

  function saveTarget(split: TargetSplit | null) {
    const before = writer.read().workflow;
    const next = withTargetSplit(before ?? undefined, split);
    if (next === before) return;
    const was = targetSplitOf(before);
    undoable({
      label: split ? "Saved the target mix" : "Cleared the target mix",
      kind: "success",
      apply: () => writer.putWorkflow(next),
      revert: () => {
        const cur = writer.read().workflow;
        // Only while the target is still the one saved here (Kanban may have changed it since).
        if (cur && sameSplit(targetSplitOf(cur), split)) {
          writer.putWorkflow(withTargetSplit(cur, was));
        }
      },
    });
    if (!example) {
      log(FLOW_INSIGHTS_ACTIONS.TARGET_SPLIT_SET, split ? { ...split } : { cleared: true });
    }
    setStatus(split ? "Saved the target mix." : "Cleared the target mix.");
  }

  /* ── Exports ── */

  const markdown = useMemo(() => toMarkdown(x, today), [x, today]);
  const promptConfig = useMemo(
    () => ({
      toolName: "Flow Insights",
      prompts: generateFlowInsightsPrompts({
        unit: x.board === "sprint" ? "sprint" : "week",
        periods: x.periods.map((p) => ({
          label: p.label,
          finished: p.finished,
          ...p.counts,
          unsorted: p.unsorted,
          failurePct: p.failurePct,
        })),
        target: x.target,
        stability: x.stability.rows.slice(-6).map((r) => ({
          name: r.name,
          people: r.people,
          joined: r.joined.length,
          left: r.left.length,
          pct: r.pct,
        })),
        trend: x.trend?.sentence ?? null,
      }),
    }),
    [x]
  );
  const csvData = {
    headers: [
      x.board === "sprint" ? "Sprint" : "Week",
      "Finished",
      "Feature",
      "Defect",
      "Debt",
      "Risk",
      "Not sorted",
      "Repeat work %",
    ],
    rows: x.periods.map((p) => [
      p.label,
      p.finished,
      p.counts.feature,
      p.counts.defect,
      p.counts.debt,
      p.counts.risk,
      p.unsorted,
      p.failurePct ?? "",
    ]),
  };

  if (!hydrated) return <WorkspaceLoading>Loading the boards…</WorkspaceLoading>;

  if (!example && !anyFinished(live, false)) {
    return (
      <EmptyState
        icon={ChartColumnStacked}
        action={<LoadExampleButton onLoad={() => setExample(buildExample(today))} />}
      >
        Finish work on the Sprint or Flow board to see its mix: what kinds of work you finish, how
        much is repeat work, and how stable the team is. Or load an example to see it filled in.
      </EmptyState>
    );
  }

  const windows = board === "sprint" ? SPRINT_WINDOWS : WEEK_WINDOWS;
  const unitWord = board === "sprint" ? "sprints" : "weeks";
  const perPeriod = x.periods.length > 0 ? x.totals.finished / x.periods.length : null;
  const latestStability = [...x.stability.rows].reverse().find((r) => r.pct !== null);

  return (
    <div className="space-y-6">
      {example && <ExampleNotice onClear={() => setExample(null)} />}

      <div className="space-y-3">
        <p className="text-base font-medium text-text">{x.verdict}</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm text-text" aria-hidden="true">
                Board
              </span>
              <ToggleGroup
                label="Board"
                size="sm"
                options={[
                  { value: "sprint", label: "Sprint board" },
                  { value: "flow", label: "Flow board" },
                ]}
                value={board}
                onValueChange={(b: FlowBoard) => useFlowInsightsPrefs.setState({ board: b })}
              />
            </div>
            <Field label="Window" className="w-40">
              {(props) => (
                <select
                  {...props}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-1 text-base text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm"
                  value={periods}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (board === "sprint")
                      useFlowInsightsPrefs.setState({ sprintWindow: n as SprintWindow });
                    else useFlowInsightsPrefs.setState({ weekWindow: n as WeekWindow });
                  }}
                >
                  {windows.map((n) => (
                    <option key={n} value={n}>
                      Last {n} {unitWord}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="flow-insights"
              markdown={markdown}
              csvData={csvData}
              jsonData={{ board: x.board, periods: csvData.rows, target: x.target }}
            />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="At a glance">
        <Tile
          term={`Finished per ${board === "sprint" ? "sprint" : "week"}`}
          value={perPeriod === null ? "—" : String(Math.round(perPeriod * 10) / 10)}
          note={`Over the last ${x.periods.length} ${unitWord}`}
        />
        <Tile
          term="Cycle time P85"
          value={x.cycleP85 === null ? "—" : `${x.cycleP85} ${x.cycleP85 === 1 ? "day" : "days"}`}
          note={x.cycleP85 === null ? `Shows from ${MIN_SAMPLE.distribution} finished` : undefined}
          href="/cycle-time"
          linkLabel="Cycle Time"
        />
        <Tile
          term="Repeat work"
          value={x.totals.failurePct === null ? "—" : `${x.totals.failurePct}%`}
          note={`${x.totals.failure} of ${x.totals.finished} finished`}
        />
        <Tile
          term="Team stability"
          value={!latestStability || latestStability.pct === null ? "—" : `${latestStability.pct}%`}
          note={latestStability ? latestStability.name : "Needs two finished sprints"}
          href="/capacity-planner"
          linkLabel="Capacity Planner"
        />
        <Tile
          term="Blocked share of cycle time"
          value={x.blocked.pct === null ? "—" : `${x.blocked.pct}%`}
          note={`Counts from ${dateLabel(BLOCK_TRACKING_SINCE)}`}
          href="/impediments"
          linkLabel="Impediments"
        />
      </dl>

      <MixSection x={x} onSaveTarget={saveTarget} />
      <FailureSection x={x} />
      <SortSection
        items={unsorted}
        data={data}
        status={status}
        onSetType={setType}
        onToggleRepeat={toggleRepeat}
        onAcceptGuesses={acceptGuesses}
        onAcceptSuggestions={acceptSuggestions}
      />
      <StabilitySection stability={x.stability} rows={board === "sprint" ? periods : 6} />
    </div>
  );
}

function Tile({
  term,
  value,
  note,
  href,
  linkLabel,
}: {
  term: string;
  value: string;
  note?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <dt className="text-xs text-sub">{term}</dt>
      <dd className="mt-1 font-data text-fluid-h2 font-bold text-text">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-sub">{note}</dd>}
      {href && linkLabel && (
        <dd className="mt-1 text-xs">
          <Link href={href} className="text-accent underline-offset-2 hover:underline">
            {linkLabel}
          </Link>
        </dd>
      )}
    </div>
  );
}
