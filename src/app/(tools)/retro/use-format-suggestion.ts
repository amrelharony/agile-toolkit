"use client";

/**
 * The format the picker suggests for the sprint a new board will look back
 * on ("Retro for"): the sprint's facts, read as the board reads them
 * (use-board-facts), through `suggestFormat`, which counts open work as
 * unfinished only once the sprint is over. Null with no sprint picked or
 * nothing in its facts that calls for one.
 */

import { useMemo } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { sprintOver, suggestFormat, type FormatSuggestion } from "@/lib/retro/suggest";
import { todayIso } from "@/lib/sprints/series";
import type { RetroCard } from "./types";
import { useBoardFacts } from "./use-board-facts";

const NO_CARDS: RetroCard[] = [];

export function useFormatSuggestion(sprintId: string | undefined): FormatSuggestion | null {
  // The board to come: no cards yet, so its facts are the sprint's alone.
  const board = useMemo(
    () => ({ sprintId, cards: NO_CARDS, format: retroFormats[0], previousRetroId: undefined }),
    [sprintId]
  );
  const { facts, sprint } = useBoardFacts(board);
  const ended = sprint ? sprintOver(sprint, todayIso()) : false;
  return useMemo(() => suggestFormat(facts, { ended }), [facts, ended]);
}
