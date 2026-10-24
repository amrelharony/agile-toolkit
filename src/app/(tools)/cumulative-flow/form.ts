/**
 * The typed snapshot's draft and its checks. A snapshot was a row of zeros
 * dated today the moment "Add Date" was pressed; now nothing is saved until
 * the date and every count are typed, and a count left blank is an error,
 * never a silent 0.
 */

import { parseNumber, type Validation } from "@/lib/utils/form";
import { isoDayNumber } from "@/lib/sprints/calendar";
import type { DataEntry, StatusColumn } from "./types";
import { MAX_COUNT } from "./constants";

export interface SnapshotDraft {
  date: string;
  /** Typed text per column id. */
  counts: Record<string, string>;
  note: string;
}

export const emptySnapshot = (date = ""): SnapshotDraft => ({ date, counts: {}, note: "" });

/** "date", "note" or "count:<column id>". */
export type SnapshotField = string;

export const countField = (columnId: string) => `count:${columnId}`;

/** Why a typed count can't be saved, or null. */
export function countError(
  raw: string | undefined,
  column: Pick<StatusColumn, "name">
): string | null {
  const n = parseNumber(raw ?? "");
  if (n === undefined) return `Enter a count for ${column.name}.`;
  if (!Number.isInteger(n) || n < 0) {
    return `${column.name} is a count of items: a whole number from 0.`;
  }
  if (n > MAX_COUNT) return `${column.name} can't be more than ${MAX_COUNT.toLocaleString()}.`;
  return null;
}

/**
 * Why a snapshot date can't be used, or null: it must be a date, not after
 * today, and not one another snapshot already has (two points on one date
 * stack on the same tick). `exceptId` skips the snapshot being edited.
 */
export function dateError(
  date: string,
  entries: readonly Pick<DataEntry, "id" | "date">[],
  today: string,
  exceptId?: string
): string | null {
  if (!date.trim()) return "Pick the date the counts are from.";
  const n = isoDayNumber(date);
  if (n === null) return "Pick a date from the calendar.";
  if (n > (isoDayNumber(today) as number)) {
    return "The counts can't be from a day that hasn't happened yet.";
  }
  if (entries.some((e) => e.id !== exceptId && e.date === date)) {
    return "A snapshot for this date already exists: edit its counts in the table instead.";
  }
  return null;
}

export function validateSnapshot(
  draft: SnapshotDraft,
  columns: readonly StatusColumn[],
  entries: readonly Pick<DataEntry, "id" | "date">[],
  today: string
): Validation<Omit<DataEntry, "id">, SnapshotField> {
  const errors: Record<string, string> = {};
  const date = dateError(draft.date, entries, today);
  if (date) errors.date = date;
  const counts: Record<string, number> = {};
  for (const c of columns) {
    const err = countError(draft.counts[c.id], c);
    if (err) errors[countField(c.id)] = err;
    else counts[c.id] = Number(draft.counts[c.id]);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const note = draft.note.trim();
  return { ok: true, values: { date: draft.date, counts, ...(note ? { description: note } : {}) } };
}

/** The column-name problem, or null: a name, and not one another column has (in any case). */
export function columnNameError(
  name: string,
  columns: readonly Pick<StatusColumn, "id" | "name">[],
  exceptId?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name the column, e.g. Blocked.";
  const want = trimmed.toLowerCase();
  return columns.some((c) => c.id !== exceptId && c.name.toLowerCase() === want)
    ? `A column named “${trimmed}” already exists.`
    : null;
}
