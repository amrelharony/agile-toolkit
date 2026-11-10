"use client";

/**
 * The format the picker suggests for the sprint a new board will look back
 * on ("Retro for"): the sprint's facts, read as the board reads them
 * (use-board-facts), through `suggestFormat`. Null with no sprint picked or
 * nothing in its facts that calls for one.
 */

import { useMemo } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { suggestFormat, type FormatSuggestion } from "@/lib/retro/suggest";
import type { RetroCard } from "./types";
import { useBoardFacts } from "./use-board-facts";

const NO_CARDS: RetroCard[] = [];

export function useFormatSuggestion(sprintId: string | undefined): FormatSuggestion | null {
  // The board to come: no cards yet, so its facts are the sprint's alone.
  const board = useMemo(
    () => ({ sprintId, cards: NO_CARDS, format: retroFormats[0], previousRetroId: undefined }),
    [sprintId]
  );
  const { facts } = useBoardFacts(board);
  return useMemo(() => suggestFormat(facts), [facts]);
}
