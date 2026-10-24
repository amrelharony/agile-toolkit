/**
 * Impediment Tracker: the draft behind the log form and the editor, its
 * checks, and how saved values land on a workspace impediment. Pure.
 *
 * The old form saved a "Technical", "Medium" impediment whether or not
 * anyone chose those, and always dated it today. Now severity is unset
 * until picked (and required), category stays empty unless chosen, and
 * the raised day starts at today but can be moved back.
 */

import type {
  Impediment,
  ImpedimentCategory,
  ImpedimentSeverity,
} from "@/lib/stores/workspace-types";
import { dayOf, impedimentDueDate, isResolved } from "@/lib/impediments/model";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { NAME_MAX, TEXT_MAX, TITLE_MAX } from "./constants";
import { isCategory, isSeverity } from "./helpers";

export interface ImpedimentDraft {
  title: string;
  description: string;
  severity: ImpedimentSeverity | null;
  /** "" for no category. */
  category: ImpedimentCategory | "";
  raisedBy: string;
  owner: string;
  raisedAt: string;
  /** "" for no due date. */
  dueDate: string;
  /** Only checked for a resolved impediment (the editor shows it then). */
  resolvedAt: string;
}

export type ImpedimentField = keyof ImpedimentDraft;

export interface ImpedimentValues {
  title: string;
  description?: string;
  severity: ImpedimentSeverity;
  category?: ImpedimentCategory;
  raisedBy?: string;
  owner?: string;
  raisedAt: string;
  dueDate?: string;
  resolvedAt?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string) => DAY.test(v) && dayOf(v) === v;

/** A blank log form: nothing chosen, raised today. */
export function emptyDraft(today: string): ImpedimentDraft {
  return {
    title: "",
    description: "",
    severity: null,
    category: "",
    raisedBy: "",
    owner: "",
    raisedAt: today,
    dueDate: "",
    resolvedAt: "",
  };
}

/**
 * The editor's draft for a stored row. A due date that comes from the
 * expected days shows as that date; an agent's full timestamp shows as its
 * day; a severity or category the page doesn't know starts unset.
 */
export function draftFrom(i: Impediment): ImpedimentDraft {
  return {
    title: typeof i.title === "string" ? i.title : "",
    description: i.description ?? "",
    severity: isSeverity(i.severity) ? i.severity : null,
    category: isCategory(i.category) ? i.category : "",
    raisedBy: i.raisedBy ?? "",
    owner: i.owner ?? "",
    raisedAt: dayOf(i.raisedAt) ?? "",
    dueDate: impedimentDueDate(i) ?? "",
    resolvedAt: dayOf(i.resolvedAt) ?? "",
  };
}

/**
 * Check a draft against `today`. A missing title or severity is an error,
 * never a default. Dates can be in the past (backdating is the point) but
 * not the future, and nothing is due or resolved before it was raised.
 * `resolved` checks the resolved day too (the editor of a resolved row).
 */
export function validateImpediment(
  d: ImpedimentDraft,
  today: string,
  { resolved = false }: { resolved?: boolean } = {}
): Validation<ImpedimentValues, ImpedimentField> {
  const errors: FormErrors<ImpedimentField> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Enter a title.";
  if (!d.severity) errors.severity = "Pick a severity.";

  const raisedOk = isDay(d.raisedAt);
  if (!d.raisedAt) errors.raisedAt = "Enter the day it was raised.";
  else if (!raisedOk) errors.raisedAt = "Use a date like 2026-10-24.";
  else if (d.raisedAt > today) errors.raisedAt = "It can't be raised in the future.";

  if (d.dueDate) {
    if (!isDay(d.dueDate)) errors.dueDate = "Use a date like 2026-10-31.";
    else if (raisedOk && d.dueDate < d.raisedAt)
      errors.dueDate = "It can't be due before the day it was raised.";
  }

  if (resolved) {
    if (!d.resolvedAt) errors.resolvedAt = "Enter the day it was resolved.";
    else if (!isDay(d.resolvedAt)) errors.resolvedAt = "Use a date like 2026-10-24.";
    else if (d.resolvedAt > today) errors.resolvedAt = "It can't be resolved in the future.";
    else if (raisedOk && d.resolvedAt < d.raisedAt)
      errors.resolvedAt = "It can't be resolved before it was raised.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = d.description.trim();
  const raisedBy = d.raisedBy.trim();
  const owner = d.owner.trim();
  return {
    ok: true,
    values: {
      title: title.slice(0, TITLE_MAX),
      severity: d.severity as ImpedimentSeverity,
      raisedAt: d.raisedAt,
      ...(description ? { description: description.slice(0, TEXT_MAX) } : {}),
      ...(d.category ? { category: d.category } : {}),
      ...(raisedBy ? { raisedBy: raisedBy.slice(0, NAME_MAX) } : {}),
      ...(owner ? { owner: owner.slice(0, NAME_MAX) } : {}),
      ...(d.dueDate ? { dueDate: d.dueDate } : {}),
      ...(resolved ? { resolvedAt: d.resolvedAt } : {}),
    },
  };
}

/** Just the resolved day, for "Resolve" (defaults to today, can be moved back). */
export function validateResolvedDay(
  day: string,
  raisedAt: string | undefined,
  today: string
): Validation<string, "resolvedAt"> {
  const raised = dayOf(raisedAt);
  if (!day) return { ok: false, errors: { resolvedAt: "Enter the day it was resolved." } };
  if (!isDay(day)) return { ok: false, errors: { resolvedAt: "Use a date like 2026-10-24." } };
  if (day > today)
    return { ok: false, errors: { resolvedAt: "It can't be resolved in the future." } };
  if (raised && day < raised)
    return { ok: false, errors: { resolvedAt: "It can't be resolved before it was raised." } };
  return { ok: true, values: day };
}

/** A new impediment logged on this page. */
export function newImpediment(v: ImpedimentValues, id: string): Impediment {
  const { resolvedAt, ...rest } = v;
  void resolvedAt;
  return { id, ...rest, source: "manual" };
}

type Optional = "description" | "category" | "raisedBy" | "owner";
const OPTIONAL: readonly Optional[] = ["description", "category", "raisedBy", "owner"];

/**
 * `row` with the editor's values. Untouched fields keep exactly what is
 * stored: a raised or resolved day that didn't change keeps an agent's full
 * timestamp, and a due date that still reads as the expected days stays
 * expected days (so moving the raised day moves it too). Clearing the due
 * date clears both. Fields the page doesn't edit (source, tags, the
 * escalation day) are kept. Unchanged: the same object.
 */
export function applyValues(row: Impediment, v: ImpedimentValues): Impediment {
  const next: Impediment = { ...row, title: v.title, severity: v.severity };
  for (const key of OPTIONAL) {
    const value = v[key];
    if (value === undefined) delete next[key];
    else (next as unknown as Record<Optional, string>)[key] = value;
  }
  if (dayOf(row.raisedAt) !== v.raisedAt) next.raisedAt = v.raisedAt;
  if (isResolved(row) && v.resolvedAt && dayOf(row.resolvedAt) !== v.resolvedAt)
    next.resolvedAt = v.resolvedAt;

  const shownDue = impedimentDueDate(row);
  if (!v.dueDate) {
    delete next.dueDate;
    delete next.expectedResolutionDays;
  } else if (v.dueDate !== shownDue) {
    next.dueDate = v.dueDate;
  }
  return sameImpediment(row, next) ? row : next;
}

/** Field-by-field, ignoring key order. */
export function sameImpediment(a: Impediment, b: Impediment): boolean {
  const keys = Object.keys(a).concat(Object.keys(b));
  for (const k of keys) {
    const x = (a as unknown as Record<string, unknown>)[k];
    const y = (b as unknown as Record<string, unknown>)[k];
    if (x === y) continue;
    if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}
