/**
 * Retro Actions' AI task, the def (prompt in retro-actions.server.ts; pages
 * import `retro-actions.lite.ts`, which holds the fallback):
 *
 *   retro-actions.themes  the past retros' cards (text only, each with its
 *                         retro's number and date) → up to 10 themes that
 *                         came up in three or more retros, with their cards
 *
 * Cards travel by short ids ("c1"…), never the board's own, and the page
 * reads the answer against the boards (lib/retro/recurring-themes): unknown
 * ids are dropped and a theme under three retros is left out. Fallback: the
 * shared words across the retros (keywordRecurring).
 */

import { z } from "zod";
import {
  RECURRING_THEMES_MAX,
  THEME_CARDS_MAX,
  THEME_CARD_TEXT_MAX,
} from "@/lib/retro/recurring-themes";
import { RETRO_ARCHIVE_LIMIT } from "@/app/(tools)/retro/archive";
import { defineAiTask } from "../define-task";
import { retroActionsThemesFallback } from "./retro-actions.lite";

export { fallbackThemes, retroActionsThemesFallback } from "./retro-actions.lite";

const Line = (max: number) => z.string().trim().max(max);

const input = z.object({
  retros: z
    .array(
      z.object({
        n: z.number().int().min(1).max(RETRO_ARCHIVE_LIMIT),
        date: Line(10),
      })
    )
    .min(1)
    .max(RETRO_ARCHIVE_LIMIT),
  cards: z
    .array(
      z.object({
        id: Line(8).min(1),
        r: z.number().int().min(1).max(RETRO_ARCHIVE_LIMIT),
        text: Line(THEME_CARD_TEXT_MAX).min(1),
      })
    )
    .min(1)
    .max(THEME_CARDS_MAX),
});

const output = z.object({
  themes: z
    .array(
      z.object({
        name: Line(60).min(1),
        cardIds: z.array(Line(8).min(1)).min(1).max(100),
        count: z.number().int().min(0).max(THEME_CARDS_MAX),
      })
    )
    .max(RECURRING_THEMES_MAX),
});

export type RecurringThemesInput = z.infer<typeof input>;
export type RecurringThemesOutput = z.infer<typeof output>;

export const retroActionsThemesTask = defineAiTask({
  id: "retro-actions.themes",
  toolId: "retro-actions",
  tier: "full",
  effort: "high",
  maxTokens: 8192,
  input,
  output,
  fallback: retroActionsThemesFallback,
  sample: {
    retros: [
      { n: 1, date: "2026-09-18" },
      { n: 2, date: "2026-10-02" },
      { n: 3, date: "2026-10-16" },
    ],
    cards: [
      { id: "c1", r: 1, text: "Flaky UI tests blocked two merges" },
      { id: "c2", r: 1, text: "Staging was down for a whole day" },
      { id: "c3", r: 2, text: "Flaky tests came back on the payment page" },
      { id: "c4", r: 2, text: "Staging data was out of date" },
      { id: "c5", r: 3, text: "Flaky tests again, this time on search" },
      { id: "c6", r: 3, text: "Waited two days for staging" },
    ],
  },
});
