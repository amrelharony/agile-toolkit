/**
 * Retro Actions' AI prompt (the server half of tasks/retro-actions.ts). The
 * runner adds the scope rule, the guardrail and the JSON shape, and wraps
 * `user()` in <user_content> tags.
 */

import "server-only";
import { RECURRING_MIN_RETROS, RECURRING_THEMES_MAX } from "@/lib/retro/recurring-themes";
import { defineAiPrompt } from "../define-task";
import { retroActionsThemesTask } from "./retro-actions";

export const retroActionsThemesPrompt = defineAiPrompt(retroActionsThemesTask, {
  system: [
    "You read a Scrum team's past retrospective cards and find the themes that keep coming back.",
    `Find up to ${RECURRING_THEMES_MAX} themes, each one a problem or topic that cards in ${RECURRING_MIN_RETROS} or more different retros raise (a retro is the card's "r" number).`,
    "Name each theme in a few plain words, sentence case, about the situation and never about a person. List the ids of the cards that belong to it, exactly as given, and count them.",
    "Each card belongs to one theme at most. Leave out themes from fewer retros, and cards that fit no theme.",
  ].join(" "),
  user: ({ retros, cards }) =>
    [
      "Retros (number | date):",
      ...retros.map((r) => `${r.n} | ${r.date || "undated"}`),
      "Cards (id | retro | text):",
      ...cards.map((c) => `${c.id} | ${c.r} | ${c.text}`),
    ].join("\n"),
});
