/**
 * The notebook's data-aware next step (lib/tools/next-steps): a theme that
 * keeps coming up in the coach's own notes points to the tool that helps
 * with it, or to the retro when no tool does. Example notes and kept
 * summaries don't count. The step names the tag the coach typed (or the
 * theme its words point to); it is shown on the notebook's own page only.
 */

import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { isSummaryNote, normalizeEntries, realNotes, shiftDay } from "./model";
import { themeCounts, themeTool } from "./themes";
import { linkableTool } from "./tools";

/** The window a theme must repeat in, ending today. */
export const NEXT_STEP_DAYS = 14;
/** How many notes in the window make a theme worth acting on. */
export const NEXT_STEP_NOTES = 3;

export interface NotebookNextStep {
  id: string;
  label: string;
  detail?: string;
  href: string;
}

/** The step for the theme that came up most in the last two weeks, if one came up often enough. */
export function notebookNextSteps(
  entries: readonly NotebookEntry[] | undefined,
  today: string
): NotebookNextStep[] {
  const from = shiftDay(today, -(NEXT_STEP_DAYS - 1));
  const recent = realNotes(normalizeEntries(entries ?? [])).filter(
    (e) => e.date >= from && e.date <= today && !isSummaryNote(e)
  );
  const top = themeCounts(recent).find((t) => t.notes >= NEXT_STEP_NOTES);
  if (!top) return [];
  const detail = `“${top.tag}” came up in ${top.notes} of your notes in the last two weeks.`;
  const tool = linkableTool(themeTool(top.tag));
  if (tool) {
    return [
      {
        id: "sm-notebook-theme",
        label: `Try ${tool.name} for “${top.tag}”`,
        detail,
        href: tool.path,
      },
    ];
  }
  return [
    { id: "sm-notebook-retro", label: `Take “${top.tag}” to the retro`, detail, href: "/retro" },
  ];
}
