"use client";

/**
 * The sprint a new board will look back on, as "Surprise me" hands it to
 * Amr (retro.surprise_plan): the numbers the format suggestion reads and
 * the board's fact lines, from the same facts the board opens with
 * (use-board-facts). Null with no sprint picked.
 */

import { useMemo } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { sprintOver } from "@/lib/retro/suggest";
import { surpriseSprintInput, type SurpriseSprintInput } from "@/lib/retro/surprise";
import { todayIso } from "@/lib/sprints/series";
import type { RetroCard } from "./types";
import { factLines } from "./facts-text";
import { useBoardFacts } from "./use-board-facts";

const NO_CARDS: RetroCard[] = [];

export function useSurpriseSprint(sprintId: string | undefined): SurpriseSprintInput | null {
  const board = useMemo(
    () => ({ sprintId, cards: NO_CARDS, format: retroFormats[0], previousRetroId: undefined }),
    [sprintId]
  );
  const { facts, sprint, impedimentsRecorded } = useBoardFacts(board);
  return useMemo(() => {
    if (!facts) return null;
    const ended = sprint ? sprintOver(sprint, todayIso()) : false;
    const lines = factLines(facts, { links: false, impedimentsRecorded }).map(
      (l) => `${l.label}: ${l.sentence}`
    );
    return surpriseSprintInput(facts, ended, lines);
  }, [facts, sprint, impedimentsRecorded]);
}
