"use client";

/**
 * The sprint a retro board looks back on, and the facts it opens with,
 * read live from the workspace (Sprint Goal, the sprint's stories,
 * Impediments, Mood Tracker, Kudos, the past retros and where their actions
 * were sent).
 *
 * The example board names no sprint and gets the example's own facts, so a
 * visitor exploring it never sees (or is shown as) a real sprint's numbers.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { hasExampleItems } from "@/components/tool-frame/example-data";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import { retroFacts, type RetroFacts } from "@/lib/retro/facts";
import { sprintsNewestFirst, todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import { EXAMPLE_FACTS } from "./example";
import type { BoardState } from "./types";

const NONE: never[] = [];

export interface BoardFacts {
  /** Every sprint, newest first, for the picker. */
  sprints: Sprint[];
  /** The sprint the board names, while it still exists. */
  sprint: Sprint | undefined;
  /** The board names a sprint that has since been deleted. */
  sprintGone: boolean;
  /** The facts for the board's sprint, the example's, or null with no sprint. */
  facts: RetroFacts | null;
  /** The facts are the example's (the board holds the example, with no sprint). */
  example: boolean;
}

export function useBoardFacts(
  board: Pick<BoardState, "sprintId" | "cards" | "format">
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
  const sprint = board.sprintId ? allSprints.find((s) => s.id === board.sprintId) : undefined;
  const example = !board.sprintId && hasExampleItems(board.cards);
  const today = todayIso();

  const facts = useMemo(() => {
    if (example) return EXAMPLE_FACTS;
    if (!sprint) return null;
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
    return retroFacts({
      sprint,
      sprints: allSprints,
      stories,
      goals,
      impediments,
      moodEntries,
      retroBoards: [...archives, current],
      kudos,
      today,
      // Read when the facts are built; impediments and the Kanban boards
      // are dependencies so a target finishing rebuilds them.
      targetDone: (link) => getHandoffRoute(link.route).isDone?.(link.targetId) ?? false,
    });
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
    kudos,
    kanbanBoards,
    today,
  ]);

  return {
    sprints,
    sprint,
    sprintGone: Boolean(board.sprintId) && !sprint,
    facts,
    example,
  };
}
