/**
 * Hill Chart's form checks: a chart (its title, what it covers, the sprint
 * or epic it follows) and a scope (its title, where it starts, the story or
 * epic it follows, a note). Pure. The caps are the CRUD's, so an agent's
 * update of the same chart is never refused for what the page saved.
 */

import { TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { HILL_DONE, type ScopeValues } from "@/lib/hill-chart/model";

export interface ChartDraft {
  title: string;
  about: string;
  sprintId: string;
  epicId: string;
}
export type ChartField = keyof ChartDraft;
export interface ChartValues {
  title: string;
  about?: string;
  sprintId?: string;
  epicId?: string;
}

export const EMPTY_CHART: ChartDraft = { title: "", about: "", sprintId: "", epicId: "" };

/** A chart needs a title; what it covers stays within its cap. */
export function validateChart(d: ChartDraft): Validation<ChartValues, ChartField> {
  const errors: FormErrors<ChartField> = {};
  const title = d.title.trim();
  const about = d.about.trim();
  if (!title) errors.title = "Name the chart, such as the sprint goal or the epic.";
  else if (title.length > TOOL_TEXT_MAX.short)
    errors.title = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  if (about.length > TOOL_TEXT_MAX.text)
    errors.about = `Keep this to ${TOOL_TEXT_MAX.text} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      ...(about ? { about } : {}),
      ...(d.sprintId ? { sprintId: d.sprintId } : {}),
      ...(d.epicId ? { epicId: d.epicId } : {}),
    },
  };
}

export interface ScopeDraft {
  title: string;
  /** Typed as text, so an empty box is an error, not 0. */
  position: string;
  storyId: string;
  epicId: string;
  note: string;
}
export type ScopeField = keyof ScopeDraft;

export const EMPTY_SCOPE: ScopeDraft = {
  title: "",
  position: "0",
  storyId: "",
  epicId: "",
  note: "",
};

/** The draft for an existing scope. */
export const scopeDraftFrom = (s: {
  title: string;
  position: number;
  storyId?: string;
  epicId?: string;
  note?: string;
}): ScopeDraft => ({
  title: s.title,
  position: String(s.position),
  storyId: s.storyId ?? "",
  epicId: s.epicId ?? "",
  note: s.note ?? "",
});

/** A position typed in: a whole number from 0 to 100, or why not. */
export function positionError(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Type where it is, from 0 to 100.";
  if (!/^\d+$/.test(t)) return "Use a whole number from 0 to 100.";
  const n = Number(t);
  if (n > HILL_DONE) return "Use a whole number from 0 to 100.";
  return null;
}

/** A scope needs a title and a position from 0 to 100; its note stays within its cap. */
export function validateScope(d: ScopeDraft): Validation<ScopeValues, ScopeField> {
  const errors: FormErrors<ScopeField> = {};
  const title = d.title.trim();
  const note = d.note.trim();
  if (!title) errors.title = "Name the piece of work.";
  else if (title.length > TOOL_TEXT_MAX.short)
    errors.title = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  const position = positionError(d.position);
  if (position) errors.position = position;
  if (note.length > TOOL_TEXT_MAX.capture)
    errors.note = `Keep the note to ${TOOL_TEXT_MAX.capture} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      position: Number(d.position.trim()),
      ...(d.storyId ? { storyId: d.storyId } : {}),
      ...(d.epicId ? { epicId: d.epicId } : {}),
      ...(note ? { note } : {}),
    },
  };
}
