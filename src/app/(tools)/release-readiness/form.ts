/**
 * Release Readiness: the drafts behind the add form, the release editor and
 * the gate editor, their checks, and how saved values land on a release.
 * Pure.
 *
 * The old form saved a release planned for today when no date was picked,
 * and ignored an Add with no name without saying why. Now both are
 * required and say so; the planned date can be in the past (a release
 * logged late) and is never filled in for the user.
 */

import type { Release } from "@/lib/stores/workspace-types";
import { isIsoDate } from "@/lib/sprints/calendar";
import type { FormErrors, Validation } from "@/lib/utils/form";

/** Caps, as the agent actions enforce them (tool.release_readiness.add_release). */
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const GATE_LABEL_MAX = 80;
export const GATE_DESCRIPTION_MAX = 200;

export interface ReleaseDraft {
  name: string;
  /** "YYYY-MM-DD", or "" until picked. */
  plannedDate: string;
  description: string;
}

export type ReleaseField = keyof ReleaseDraft;

export interface ReleaseValues {
  name: string;
  plannedDate: string;
  description?: string;
}

export const EMPTY_RELEASE: ReleaseDraft = { name: "", plannedDate: "", description: "" };

/** One line, trimmed: pasted line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** Check a release draft: a name and a planned day, nothing defaulted. */
export function validateRelease(d: ReleaseDraft): Validation<ReleaseValues, ReleaseField> {
  const errors: FormErrors<ReleaseField> = {};
  const name = oneLine(d.name);
  const description = d.description.trim();
  if (!name) errors.name = "Name the release, e.g. v3.4 Checkout redesign.";
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters.`;
  if (!d.plannedDate) errors.plannedDate = "Pick the day it is planned to ship.";
  else if (!isIsoDate(d.plannedDate)) errors.plannedDate = "Use a date like 2026-11-05.";
  if (description.length > DESCRIPTION_MAX)
    errors.description = `Keep the description to ${DESCRIPTION_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { name, plannedDate: d.plannedDate, ...(description ? { description } : {}) },
  };
}

/** The editor's draft for a stored release. */
export function draftFrom(r: Release): ReleaseDraft {
  return {
    name: typeof r.name === "string" ? r.name : "",
    plannedDate: isIsoDate(r.plannedDate) ? r.plannedDate.slice(0, 10) : "",
    description: r.description ?? "",
  };
}

/** A new release in planning, every gate open. */
export function newRelease(v: ReleaseValues, id: string): Release {
  return { id, status: "planning", gates: {}, ...v };
}

/** `r` with the editor's values; unchanged: the same object. */
export function applyRelease(r: Release, v: ReleaseValues): Release {
  if (
    r.name === v.name &&
    r.plannedDate === v.plannedDate &&
    (r.description ?? "") === (v.description ?? "")
  ) {
    return r;
  }
  const { description, ...rest } = r;
  void description;
  return {
    ...rest,
    name: v.name,
    plannedDate: v.plannedDate,
    ...(v.description ? { description: v.description } : {}),
  };
}

/* ── A gate in the team's list ──────────────────────────────────────── */

export interface GateDraft {
  label: string;
  description: string;
}

export type GateField = keyof GateDraft;

export interface GateValues {
  label: string;
  description?: string;
}

export const EMPTY_GATE: GateDraft = { label: "", description: "" };

/** A gate needs a name; `taken` holds the labels of the gates already on the list. */
export function validateGate(
  d: GateDraft,
  taken: readonly string[] = []
): Validation<GateValues, GateField> {
  const errors: FormErrors<GateField> = {};
  const label = oneLine(d.label);
  const description = oneLine(d.description);
  if (!label) errors.label = "Name the gate, e.g. Smoke test in staging.";
  else if (label.length > GATE_LABEL_MAX) errors.label = `Keep it to ${GATE_LABEL_MAX} characters.`;
  else if (taken.some((t) => t.trim().toLowerCase() === label.toLowerCase()))
    errors.label = "There is a gate with that name already.";
  if (description.length > GATE_DESCRIPTION_MAX)
    errors.description = `Keep it to ${GATE_DESCRIPTION_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { label, ...(description ? { description } : {}) } };
}
