/**
 * Retro Actions' AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `retro-actions.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { keywordRecurring } from "@/lib/retro/recurring-themes";
import type { RecurringThemesInput, RecurringThemesOutput } from "./retro-actions";
export type { RecurringThemesInput, RecurringThemesOutput } from "./retro-actions";

/** Without AI: the words cards in three or more retros share. */
export function fallbackThemes(cards: readonly { id: string; r: number; text: string }[]): {
  name: string;
  cardIds: string[];
  count: number;
}[] {
  return keywordRecurring(cards.map((c) => ({ id: c.id, retro: String(c.r), text: c.text }))).map(
    (g) => ({ name: g.name, cardIds: g.cardIds.slice(0, 100), count: g.cardIds.length })
  );
}

/** The task's answer without AI. */
export const retroActionsThemesFallback = ({
  cards,
}: RecurringThemesInput): RecurringThemesOutput => ({ themes: fallbackThemes(cards) });

export const retroActionsThemesTask = lazyAiTask<RecurringThemesInput, RecurringThemesOutput>(
  { id: "retro-actions.themes", toolId: "retro-actions", fallback: retroActionsThemesFallback },
  () => import("./retro-actions").then((m) => m.retroActionsThemesTask)
);
