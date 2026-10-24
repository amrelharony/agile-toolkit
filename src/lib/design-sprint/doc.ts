/**
 * The design sprint document, read and edited the same way by the Design
 * Sprint page and the tool.design_sprint.* agent actions: its days, their
 * outputs, and the old free-text artifacts read as notes. Pure.
 */

import type {
  DesignSprintDay,
  DesignSprintDayNumber,
  DesignSprintOutput,
  DesignSprintOutputKind,
  DesignSprintPlan,
} from "@/lib/stores/workspace-types";
import { DESIGN_SPRINT_DAY_NAMES, DESIGN_SPRINT_DAY_NUMBERS } from "./plan";

/** The one design sprint document's id (the page, its agent actions, the next steps). */
export const DESIGN_SPRINT_ID = "designSprint:current";

export const OUTPUT_TEXT_MAX = 1000;
export const OUTPUT_URL_MAX = 2000;
/** A design sprint tests with five customers. */
export const INTERVIEWS = 5;

export interface OutputKindRule {
  /** The day it belongs to; null for a note, which every day holds. */
  day: DesignSprintDayNumber | null;
  /** One item (the goal, the target, the decision…), not a list. */
  single: boolean;
  /** Takes a link (a Figma file, a photo of the whiteboard, the prototype). */
  link: boolean;
}

/** Where each kind of output goes. The page's slots (DAY_SLOTS) follow it. */
export const OUTPUT_KINDS: Readonly<Record<DesignSprintOutputKind, OutputKindRule>> = {
  "long-term-goal": { day: 1, single: true, link: false },
  "sprint-question": { day: 1, single: false, link: false },
  target: { day: 1, single: true, link: true },
  sketch: { day: 2, single: false, link: true },
  decision: { day: 3, single: true, link: false },
  storyboard: { day: 3, single: true, link: true },
  prototype: { day: 4, single: true, link: true },
  finding: { day: 5, single: false, link: false },
  note: { day: null, single: false, link: true },
};

export const DESIGN_SPRINT_OUTPUT_KINDS = Object.keys(OUTPUT_KINDS) as DesignSprintOutputKind[];

/** A web link someone can open: http or https, nothing else (no javascript:). */
export function isWebLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/* ── Old free-text artifacts ────────────────────────────────────────── */

/** djb2 over the text, base 36: short, and the same on every device. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * The id an old artifact gets as a note. It depends only on the day, the
 * position and the text, so every read and every device gives the same id,
 * and moving the artifacts into outputs twice can't make a duplicate.
 */
export function legacyNoteId(day: number, index: number, text: string): string {
  return `note-${day}-${index}-${hash(text)}`;
}

/**
 * A day's outputs, its old artifacts first as notes (they're older). The
 * artifacts had no ids and were removed by position, so a concurrent edit
 * could delete the wrong one; read here, each gets its stable id. An
 * artifact that is only a link becomes a note with that link.
 */
export function dayOutputs(day: DesignSprintDay): DesignSprintOutput[] {
  const outputs = Array.isArray(day.outputs) ? day.outputs : [];
  const artifacts = Array.isArray(day.artifacts) ? day.artifacts : [];
  if (artifacts.length === 0) return outputs;
  const ids = new Set(outputs.map((o) => o.id));
  const notes: DesignSprintOutput[] = [];
  artifacts.forEach((raw, i) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return;
    const id = legacyNoteId(day.day, i, text);
    if (ids.has(id)) return;
    notes.push({ id, kind: "note", text, ...(isWebLink(text) ? { url: text } : {}) });
  });
  return [...notes, ...outputs];
}

/** The day with its old artifacts moved into `outputs`, ids kept. A no-op once moved. */
export function withLegacyNotes(day: DesignSprintDay): DesignSprintDay {
  if (!Array.isArray(day.artifacts) || day.artifacts.length === 0) return day;
  return { ...day, artifacts: [], outputs: dayOutputs(day) };
}

/* ── Days ───────────────────────────────────────────────────────────── */

function emptyDay(day: DesignSprintDayNumber): DesignSprintDay {
  return { day, dayName: DESIGN_SPRINT_DAY_NAMES[day], tasks: [], artifacts: [], outputs: [] };
}

/** The five days in order, a missing one filled in empty (for reading). */
export function planDays(plan: Pick<DesignSprintPlan, "days">): DesignSprintDay[] {
  const days = Array.isArray(plan.days) ? plan.days : [];
  return DESIGN_SPRINT_DAY_NUMBERS.map((n) => days.find((d) => d.day === n) ?? emptyDay(n));
}

export function planDay(
  plan: Pick<DesignSprintPlan, "days">,
  day: DesignSprintDayNumber
): DesignSprintDay {
  return planDays(plan).find((d) => d.day === day) ?? emptyDay(day);
}

/**
 * The plan with one day changed by `fn`. The day's old artifacts move into
 * outputs first, so the first edit of a day converts it. A day the stored
 * plan lacks is added.
 */
export function updateDay(
  plan: DesignSprintPlan,
  day: DesignSprintDayNumber,
  fn: (d: DesignSprintDay) => DesignSprintDay
): DesignSprintPlan {
  const days = Array.isArray(plan.days) ? plan.days : [];
  if (!days.some((d) => d.day === day)) {
    const next = [...days, fn(emptyDay(day))].sort((a, b) => a.day - b.day);
    return { ...plan, days: next };
  }
  return {
    ...plan,
    days: days.map((d) => (d.day === day ? fn(withLegacyNotes(d)) : d)),
  };
}

/* ── Outputs ────────────────────────────────────────────────────────── */

export function withOutputPatch(
  day: DesignSprintDay,
  id: string,
  patch: (o: DesignSprintOutput) => DesignSprintOutput
): DesignSprintDay {
  return { ...day, outputs: dayOutputs(day).map((o) => (o.id === id ? patch(o) : o)) };
}

/** Every output of `kind`, across the days (findings live on Test day). */
export function outputsOfKind(
  plan: Pick<DesignSprintPlan, "days">,
  kind: DesignSprintOutput["kind"]
): DesignSprintOutput[] {
  return planDays(plan).flatMap((d) => dayOutputs(d).filter((o) => o.kind === kind));
}

/** The Map day's sprint questions, which Test day answers. */
export function sprintQuestions(plan: Pick<DesignSprintPlan, "days">): DesignSprintOutput[] {
  return dayOutputs(planDay(plan, 1)).filter((o) => o.kind === "sprint-question");
}

export function findingsOf(plan: Pick<DesignSprintPlan, "days">): DesignSprintOutput[] {
  return outputsOfKind(plan, "finding");
}

/** The output with `id` and the day that holds it (old artifacts read as notes); null when there's none. */
export function findOutput(
  plan: Pick<DesignSprintPlan, "days">,
  id: string
): { day: DesignSprintDayNumber; output: DesignSprintOutput } | null {
  for (const d of planDays(plan)) {
    const output = dayOutputs(d).find((o) => o.id === id);
    if (output) return { day: d.day, output };
  }
  return null;
}
