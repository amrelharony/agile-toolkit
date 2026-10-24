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
 * The first day it can be due or resolved: the day it was raised, or today
 * when the stored raised day reads later than today. Agents stamp a full
 * UTC time, so a row written on a New York evening reads as tomorrow here,
 * and without this it couldn't be resolved until local midnight.
 */
export function earliestDay(raisedAt: string | null | undefined, today: string): string | null {
  const raised = dayOf(raisedAt);
  if (!raised) return null;
  return raised > today ? today : raised;
}

/**
 * Check a draft against `today`. A missing title or severity is an error,
 * never a default. Dates can be in the past (backdating is the point) but
 * not the future, and nothing is due or resolved before it was raised.
 * `resolved` checks the resolved day too (the editor of a resolved row).
 *
 * `stored` is the draft the editor started from. What the user left as
 * stored isn't judged again: an agent's UTC raised or resolved day can read
 * as tomorrow, and a save that only changes the severity mustn't fail on a
 * date nobody touched. Nor is stored text cut to the caps (an agent or the
 * old browser store may hold more); only new text is.
 */
export function validateImpediment(
  d: ImpedimentDraft,
  today: string,
  { resolved = false, stored }: { resolved?: boolean; stored?: ImpedimentDraft } = {}
): Validation<ImpedimentValues, ImpedimentField> {
  const kept = (k: ImpedimentField) => stored !== undefined && d[k] === stored[k];
  const cap = (k: ImpedimentField, value: string, max: number) =>
    kept(k) ? value : value.slice(0, max);
  const errors: FormErrors<ImpedimentField> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Enter a title.";
  if (!d.severity) errors.severity = "Pick a severity.";

  const raisedOk = isDay(d.raisedAt);
  if (!d.raisedAt) errors.raisedAt = "Enter the day it was raised.";
  else if (!raisedOk) errors.raisedAt = "Use a date like 2026-10-24.";
  else if (d.raisedAt > today && !kept("raisedAt"))
    errors.raisedAt = "It can't be raised in the future.";
  const floor = raisedOk ? earliestDay(d.raisedAt, today) : null;

  if (d.dueDate) {
    if (!isDay(d.dueDate)) errors.dueDate = "Use a date like 2026-10-31.";
    else if (floor && d.dueDate < floor && !(kept("dueDate") && kept("raisedAt")))
      errors.dueDate = "It can't be due before the day it was raised.";
  }

  if (resolved) {
    if (!d.resolvedAt) errors.resolvedAt = "Enter the day it was resolved.";
    else if (!isDay(d.resolvedAt)) errors.resolvedAt = "Use a date like 2026-10-24.";
    else if (d.resolvedAt > today && !kept("resolvedAt"))
      errors.resolvedAt = "It can't be resolved in the future.";
    else if (floor && d.resolvedAt < floor && !(kept("resolvedAt") && kept("raisedAt")))
      errors.resolvedAt = "It can't be resolved before it was raised.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = d.description.trim();
  const raisedBy = d.raisedBy.trim();
  const owner = d.owner.trim();
  return {
    ok: true,
    values: {
      title: cap("title", title, TITLE_MAX),
      severity: d.severity as ImpedimentSeverity,
      raisedAt: d.raisedAt,
      ...(description ? { description: cap("description", description, TEXT_MAX) } : {}),
      ...(d.category ? { category: d.category } : {}),
      ...(raisedBy ? { raisedBy: cap("raisedBy", raisedBy, NAME_MAX) } : {}),
      ...(owner ? { owner: cap("owner", owner, NAME_MAX) } : {}),
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
  const floor = earliestDay(raisedAt, today);
  if (!day) return { ok: false, errors: { resolvedAt: "Enter the day it was resolved." } };
  if (!isDay(day)) return { ok: false, errors: { resolvedAt: "Use a date like 2026-10-24." } };
  if (day > today)
    return { ok: false, errors: { resolvedAt: "It can't be resolved in the future." } };
  if (floor && day < floor)
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
 * expected days. What the "Due by" field showed is what is saved, though:
 * once the raised day moves, the expected days would move the due date with
 * it, so the shown day is written as the due date. Clearing the due date
 * clears both. Fields the page doesn't edit (source, tags, the escalation
 * day) are kept. Unchanged: the same object.
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
  const fromExpectedDays = !dayOf(row.dueDate);
  if (!v.dueDate) {
    delete next.dueDate;
    delete next.expectedResolutionDays;
  } else if (v.dueDate !== shownDue || (fromExpectedDays && next.raisedAt !== row.raisedAt)) {
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
