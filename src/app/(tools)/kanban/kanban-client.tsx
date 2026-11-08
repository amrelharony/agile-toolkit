"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { CalendarRange } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { generateKanbanPrompts } from "@/lib/ai-prompts/kanban";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DodCriterion, Story } from "@/lib/stores/workspace-types";
import { useDefinitionOfDone } from "@/lib/dod/use-definition-of-done";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { SPRINT_PARAM, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { isExampleSprintId } from "@/lib/sprints/example";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import {
  BOARD_PARAM,
  BOARD_VIEW_KEY,
  linkedBoard,
  pickBoardView,
  type BoardView,
} from "./board-view";
import { buildSprintExample } from "./example";
import { FlowBoard, useKanbanBoard } from "./flow-board";
import { DEFAULT_WIP_LIMITS, cycleStats, cycleTimeDays, throughputLastWeek } from "./flow-view";
import { sprintBoardMarkdown, toMarkdown } from "./markdown";
import { SprintBoard } from "./sprint-board";
import { SPRINT_COLUMN_LABEL, daysInColumn, sprintColumnOf } from "./sprint-view";
import {
  createExampleBoardStore,
  exampleSprintWriter,
  liveSprintWriter,
  type ExampleBoardStore,
} from "./sprint-writer";

const NO_STORIES: Story[] = [];

// Stands in for the example store while no example is open, so the hook
// that reads it runs on every render.
const NO_EXAMPLE: ExampleBoardStore = createExampleBoardStore({
  sprint: { id: "", name: "", startDate: "", endDate: "", pointsPlanned: 0, status: "planned" },
  stories: [],
});

/** The example board's Definition of Done: its cards can be ticked, in memory. */
const EXAMPLE_DOD: readonly DodCriterion[] = [
  { id: exampleId("dod-review"), label: "Code reviewed", category: "code", required: true },
  { id: exampleId("dod-tests"), label: "Tests pass in CI", category: "testing", required: true },
  { id: exampleId("dod-docs"), label: "Docs updated", category: "docs", required: false },
];

const BOARD_OPTIONS: { value: BoardView; label: string; description: string }[] = [
  {
    value: "sprint",
    label: "Sprint board",
    description: "The selected sprint's stories by status",
  },
  { value: "flow", label: "Flow board", description: "Free cards with classes of service" },
];

/**
 * /kanban: two boards behind one toggle.
 *
 *   - The Sprint board shows the selected sprint's stories by status, and
 *     is where the team moves them during the sprint: every move is
 *     stamped (`setStoryStatus`), so the cockpit, Burndown and the standup
 *     read the board instead of typed numbers. The default while a sprint
 *     is active.
 *   - The Flow board is the free board it always was (the workspace's one
 *     Kanban board, which agents read and write too): the default for a
 *     team without sprints.
 *
 * The choice is remembered per viewer, and `?board=` or a `?sprint=` link
 * opens a given board.
 */
export function KanbanClient() {
  const hydrated = useWorkspaceHydrated();
  const [board, setBoard] = useKanbanBoard();
  const { sprints, selected, select } = useSelectedSprint();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const [stored, setStored] = usePersistedLocal<BoardView | null>(BOARD_VIEW_KEY, null);
  // The team's DoD (or the DoD builder's old blob until it moves in): each
  // card on the Sprint board gets its checklist.
  const { doc: dod } = useDefinitionOfDone();
  const [linked, setLinked] = useState<BoardView | null>(null);
  // The address bar is only readable after mount (the page is prerendered).
  useEffect(() => setLinked(linkedBoard(window.location.search)), []);

  const hasActiveSprint = sprints.some((s) => s.status === "active" && !isExampleSprintId(s.id));
  const view = pickBoardView(linked, stored, hasActiveSprint);

  // The example sprint board, held in memory while it is open.
  const [exampleStore, setExampleStore] = useState<ExampleBoardStore | null>(null);
  const exampleState = useStore(exampleStore ?? NO_EXAMPLE);
  const exampleWriter = useMemo(
    () => (exampleStore ? exampleSprintWriter(exampleStore) : null),
    [exampleStore]
  );
  const openExample = () => setExampleStore(createExampleBoardStore(buildSprintExample()));
  const closeExample = () => setExampleStore(null);

  const choose = (next: BoardView) => {
    setLinked(null);
    setStored(next);
    if (next === "flow") closeExample();
    // Drop a ?board= link from the address bar, so a refresh keeps the
    // choice. For the Flow board a ?sprint= link goes too, since it opens
    // the Sprint board; the sprint stays chosen (useSelectedSprint keeps it).
    try {
      const url = new URL(window.location.href);
      const linkParams = next === "flow" ? [BOARD_PARAM, SPRINT_PARAM] : [BOARD_PARAM];
      if (linkParams.some((p) => url.searchParams.has(p))) {
        for (const p of linkParams) url.searchParams.delete(p);
        window.history.replaceState(window.history.state, "", url);
      }
    } catch {
      /* no history API: the choice still applies to this visit */
    }
  };

  const setWip = (col: keyof typeof board.wipLimits, n: number) =>
    setBoard((s) => ({ ...s, wipLimits: { ...s.wipLimits, [col]: n } }));

  /* ── What the export and AI prompts see: the board on screen ─────────── */

  const sprintOnScreen = useMemo(() => {
    if (view !== "sprint") return null;
    if (exampleStore) return { sprint: exampleState.sprint, stories: exampleState.stories };
    return selected ? { sprint: selected, stories } : null;
  }, [view, exampleStore, exampleState, selected, stories]);

  const exportProps = useMemo(() => {
    if (view === "flow") {
      return {
        filename: "kanban",
        markdown: toMarkdown(board),
        jsonData: board,
        csvData: {
          headers: [
            "Title",
            "Description",
            "Column",
            "Class",
            "Assignee",
            "Blocked",
            "Created",
            "Started",
            "Completed",
            "Cycle (days)",
          ],
          rows: board.cards.map((c) => [
            c.title,
            c.description ?? "",
            c.column,
            c.class,
            c.assignee ?? "",
            c.blocked && c.column !== "done" ? "yes" : "",
            c.createdAt,
            c.startedAt ?? "",
            c.completedAt ?? "",
            cycleTimeDays(c)?.toFixed(2) ?? "",
          ]),
        },
      };
    }
    if (!sprintOnScreen) return null;
    const { sprint, stories: all } = sprintOnScreen;
    const mine = all.filter((s) => s.sprintId === sprint.id);
    const now = new Date();
    return {
      filename: "sprint-board",
      markdown: sprintBoardMarkdown(
        {
          sprint,
          stories: all,
          wipLimits: exampleStore ? DEFAULT_WIP_LIMITS : board.wipLimits,
          dod: exampleStore ? EXAMPLE_DOD : dod.items,
        },
        now
      ),
      jsonData: { sprint, stories: mine },
      csvData: {
        headers: ["Title", "Points", "Column", "Owner", "Blocked", "Days in column"],
        rows: mine.map((s) => [
          s.title,
          typeof s.points === "number" ? s.points : "",
          SPRINT_COLUMN_LABEL[sprintColumnOf(s.status)],
          s.owner ?? "",
          s.blocked && s.status !== "done" ? "yes" : "",
          daysInColumn(s, now) ?? "",
        ]),
      },
    };
  }, [view, board, sprintOnScreen, exampleStore, dod.items]);

  const promptConfig = useMemo(() => {
    const stats = cycleStats(board.cards);
    return {
      toolName: "Kanban Board",
      prompts: generateKanbanPrompts({
        cards: board.cards,
        wipLimits: board.wipLimits,
        cycleAvg: stats.average ?? 0,
        cycleP85: stats.p85 ?? 0,
        throughputLast7: throughputLastWeek(board.cards, new Date()),
      }),
    };
  }, [board]);

  /* ── The board ───────────────────────────────────────────────────────── */

  let body: ReactNode;
  if (!hydrated) {
    body = <WorkspaceLoading>Loading the board…</WorkspaceLoading>;
  } else if (view === "flow") {
    body = <FlowBoard state={board} setState={setBoard} />;
  } else if (exampleStore && exampleWriter) {
    body = (
      <>
        <ExampleNotice onClear={closeExample} />
        <p className="-mt-2 mb-4 text-xs text-sub">
          Nothing in the example is saved: your sprints and stories stay as they are. It uses the
          default WIP limits; move stories around to see the nudge and the header update.
        </p>
        <SprintBoard
          sprint={exampleState.sprint}
          stories={exampleState.stories}
          writer={exampleWriter}
          wipLimits={DEFAULT_WIP_LIMITS}
          example
          dod={EXAMPLE_DOD}
          picker={
            <p className="text-sm text-sub">
              <span className="font-medium text-text">{exampleState.sprint.name}</span> · example
              sprint
            </p>
          }
        />
      </>
    );
  } else if (!selected) {
    body = (
      <EmptyState
        icon={CalendarRange}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/sprint-planning">Plan a sprint</Link>
            </Button>
            <LoadExampleButton label="See an example board" onLoad={openExample} />
            <Button type="button" variant="ghost" onClick={() => choose("flow")}>
              Use the Flow board
            </Button>
          </div>
        }
      >
        No sprint to show yet. Plan one in Sprint Planning and its stories show up here, one column
        per status, or use the Flow board without sprints.
      </EmptyState>
    );
  } else {
    body = (
      <SprintBoard
        key={selected.id}
        sprint={selected}
        stories={stories}
        writer={liveSprintWriter}
        wipLimits={board.wipLimits}
        onWipChange={setWip}
        onExample={openExample}
        dod={dod.items}
        picker={<SprintPicker sprints={sprints} selectedId={selected.id} onSelect={select} />}
      />
    );
  }

  return (
    <ToolPageWrapper
      toolId="kanban"
      title="Kanban Board"
      description="Run the sprint on a board of its stories, or keep a WIP-limited flow board with classes of service, cycle time and throughput."
      category="Flow & Delivery"
    >
      <ActionRow
        left={
          <ToggleGroup
            label="Board"
            size="sm"
            value={view}
            onValueChange={choose}
            options={BOARD_OPTIONS}
          />
        }
      >
        {view === "flow" && <AiPromptGenerator config={promptConfig} />}
        {exportProps && hydrated && (
          <ExportButton
            filename={exportProps.filename}
            csvData={exportProps.csvData}
            jsonData={exportProps.jsonData}
            markdown={exportProps.markdown}
          />
        )}
      </ActionRow>
      {body}
    </ToolPageWrapper>
  );
}
