/**
 * The typed item's draft and its checks. "Add Item" used to save a blank
 * row; now nothing is saved until it has a name and both dates, and a
 * finish before the start is an error, not a silent "—".
 */

import { requiredErrors, type Validation } from "@/lib/utils/form";
import { isoDayNumber } from "@/lib/sprints/calendar";
import type { WorkItem } from "./types";

export const ITEM_NAME_MAX = 200;

export interface ItemDraft {
  name: string;
  startDate: string;
  endDate: string;
}

export const EMPTY_ITEM: ItemDraft = { name: "", startDate: "", endDate: "" };

type Field = "name" | "startDate" | "endDate";

/** Why the dates can't be saved, by field; empty when they can. */
export function dateErrors(
  startDate: string,
  endDate: string,
  today: string
): Partial<Record<"startDate" | "endDate", string>> {
  const errors: Partial<Record<"startDate" | "endDate", string>> = {};
  const start = isoDayNumber(startDate);
  const end = isoDayNumber(endDate);
  const now = isoDayNumber(today) as number;
  if (!startDate.trim()) {
    errors.startDate = "Pick the day work started.";
  } else if (start === null) {
    errors.startDate = "Pick a date from the calendar.";
  } else if (start > now) {
    errors.startDate = "Work can't have started on a day that hasn't happened yet.";
  }
  if (!endDate.trim()) {
    errors.endDate = "Pick the day it was finished.";
  } else if (end === null) {
    errors.endDate = "Pick a date from the calendar.";
  } else if (end > now) {
    errors.endDate = "It can't have finished on a day that hasn't happened yet.";
  } else if (start !== null && end < start) {
    errors.endDate = "The finish can't be before the start.";
  }
  return errors;
}

/**
 * Why a date edited in place on a typed item can't be saved, or null. A
 * start moved past the finish is refused on the start itself: dateErrors
 * files the order on the finish, so checking only the edited field let it
 * through, and the item dropped out of every statistic with a "—".
 */
export function editDateError(
  item: Pick<WorkItem, "startDate" | "endDate">,
  field: "startDate" | "endDate",
  value: string,
  today: string
): string | null {
  const next = { ...item, [field]: value };
  const errors = dateErrors(next.startDate, next.endDate, today);
  if (errors[field]) return errors[field];
  const start = isoDayNumber(next.startDate);
  const end = isoDayNumber(next.endDate);
  if (field === "startDate" && start !== null && end !== null && start > end) {
    return `The start can't be after the finish (${item.endDate}).`;
  }
  return null;
}

export function validateItem(
  draft: ItemDraft,
  today: string
): Validation<Omit<WorkItem, "id">, Field> {
  const errors = {
    ...requiredErrors<Field>({ name: draft.name }, { name: "Name the item, e.g. a story title." }),
    ...dateErrors(draft.startDate, draft.endDate, today),
  };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name: draft.name.trim().slice(0, ITEM_NAME_MAX),
      startDate: draft.startDate,
      endDate: draft.endDate,
    },
  };
}
