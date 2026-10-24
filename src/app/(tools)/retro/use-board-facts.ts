"use client";

/**
 * The sprint a retro board looks back on, and the facts it opens with,
 * read live from the workspace (Sprint Goal, the sprint's stories,
 * Impediments, Mood Tracker, Kudos, the past retros and where their actions
 * were sent).
 *
 * A board holding the example gets the example's own facts, whatever
 * sprint it names, so a visitor exploring it never sees (or is shown as) a
 * real sprint's numbers.
 *
 * It also picks the one retro this board follows, so the "Last retro's
 * actions" fact and the "Actions from the last retro" panel always talk
 * about the same retro.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { followThroughByRetro } from "@/lib/retro/actions";
import { RETRO_CURRENT_ID, newestArchivedRetro } from "@/lib/retro/board";
import { retroFacts, type RetroFacts } from "@/lib/retro/facts";
import { sayDoRatio } from "@/lib/sprints/metrics";
import { sprintsNewestFirst, todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink, RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import { EXAMPLE_FACTS } from "./example";
import type { BoardState } from "./types";

const NONE: never[] = [];

export interface BoardFacts {
  /** Every sprint, newest first, for the picker. */
  sprints: Sprint[];
  /** The sprint the board names, while it still exists (never on the example). */
  sprint: Sprint | undefined;
  /** The board names a sprint that has since been deleted. */
  sprintGone: boolean;
  /** The facts for the board's sprint, the example's, or null with no sprint. */
  facts: RetroFacts | null;
  /** The facts are the example's (the board holds example cards). */
  example: boolean;
  /**
   * The archived retro this board follows, for the follow-through fact and
   * the "Actions from the last retro" panel alike; null when there is none
   * (and on the example, whose last retro isn't one of the team's).
   */
  previousRetroId: string | null;
  /** Whether the team has recorded any impediment at all (example ones aside). */
  impedimentsRecorded: boolean;
}

/**
 * Say/do for a closed sprint, from the numbers recorded on it. Closing a
 * sprint moves its unfinished stories to the next sprint or the backlog,
 * so the stories left in it are the done ones and would read as 100%.
 * Sprint Planning records the commitment when the sprint starts and
 * closing it records the points done. A closed sprint without a recorded
 * commitment keeps the stories' numbers.
 */
export function withClosedSprintSayDo(facts: RetroFacts, sprint: Sprint): RetroFacts {
  if (sprint.status !== "completed") return facts;
  const sayDo = sayDoRatio(sprint.pointsPlanned, sprint.pointsCompleted);
  if (!sayDo) return facts;
  return {
    ...facts,
    committed: sprint.pointsPlanned,
    completed: Math.max(0, sprint.pointsCompleted ?? 0),
    fromStories: false,
    sayDo,
  };
}

/**
 * The retro a board follows: the archive its `previousRetroId` names (the
 * newest one when the board was started; the one its actions are carried
 * from), else the one the facts quote for its sprint, else, with no sprint,
 * the newest archive.
 */
export function followedRetroId(
  archives: readonly RetroBoard[],
  previousRetroId: string | undefined,
  facts: RetroFacts | null
): string | null {
  if (previousRetroId && archives.some((b) => b.id === previousRetroId)) return previousRetroId;
  if (facts) return facts.followThrough?.boardId ?? null;
  return newestArchivedRetro(archives)?.id ?? null;
}

export function useBoardFacts(
  board: Pick<BoardState, "sprintId" | "cards" | "format" | "previousRetroId">
): BoardFacts {
  const allSprints = useWorkspaceStore((s) => s.sprints) ?? NONE;
  const stories = useWorkspaceStore((s) => s.stories) ?? NONE;
  const goals = useWorkspaceStore((s) => s.sprintGoals) ?? NONE;
  const impediments = useWorkspaceStore((s) => s.impediments) ?? NONE;
  const moodEntries = useWorkspaceStore((s) => s.moodEntries) ?? NONE;
  const kudos = useWorkspaceStore((s) => s.kudos) ?? NONE;
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards) ?? NONE;
  // Only the archives: the current board is upserted on every timer tick,
  // and its cards come in through `board` instead.
  const archives = useWorkspaceStore(
    useShallow((s) => (s.retroBoards ?? NONE).filter((b) => typeof b.archivedAt === "string"))
  );

  const sprints = useMemo(() => sprintsNewestFirst(allSprints), [allSprints]);
  // Example cards decide it, not the sprint: an example board that names a
  // sprint (an agent's set_sprint) still never reads that sprint's data.
  const example = hasExampleItems(board.cards);
  const named = board.sprintId ? allSprints.find((s) => s.id === board.sprintId) : undefined;
  const sprint = example ? undefined : named;
  const today = todayIso();
  const impedimentsRecorded = impediments.some((i) => !isExampleId(i.id));

  const { facts, previousRetroId } = useMemo(() => {
    if (example) return { facts: EXAMPLE_FACTS, previousRetroId: null };
    if (!sprint) {
      return {
        facts: null,
        previousRetroId: followedRetroId(archives, board.previousRetroId, null),
      };
    }
    // The current board takes part for the carried copies of the last
    // retro's actions (a copy that got done counts as done).
    const current: RetroBoard = {
      id: RETRO_CURRENT_ID,
      format: board.format,
      phase: "write",
      cards: board.cards,
      userVotes: 0,
      timerSeconds: 0,
      timerRunning: false,
      discussingIndex: 0,
    };
    const boards = [...archives, current];
    // Read when the facts are built; impediments and the Kanban boards
    // are dependencies so a target finishing rebuilds them.
    const targetDone = (link: HandoffLink) =>
      getHandoffRoute(link.route).isDone?.(link.targetId) ?? false;
    const read = withClosedSprintSayDo(
      retroFacts({
        sprint,
        sprints: allSprints,
        stories,
        goals,
        impediments,
        moodEntries,
        retroBoards: boards,
        kudos,
        today,
        targetDone,
      }),
      sprint
    );
    const followed = followedRetroId(archives, board.previousRetroId, read);
    // The fact follows the same retro as the panel: the one this board was
    // started after, when it names one.
    const followThrough =
      followed === read.followThrough?.boardId
        ? read.followThrough
        : (followThroughByRetro(boards, { targetDone }).find((f) => f.boardId === followed) ??
          null);
    return { facts: { ...read, followThrough }, previousRetroId: followed };
    // kanbanBoards: read by the hand-off routes' isDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    example,
    sprint,
    allSprints,
    stories,
    goals,
    impediments,
    moodEntries,
    archives,
    board.cards,
    board.format,
    board.previousRetroId,
    kudos,
    kanbanBoards,
    today,
  ]);

  return {
    sprints,
    sprint,
    sprintGone: !example && Boolean(board.sprintId) && !named,
    facts,
    example,
    previousRetroId,
    impedimentsRecorded,
  };
}
