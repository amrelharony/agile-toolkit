/**
 * Custom retro formats: the team's own columns, 2 to 6 of them, named in the
 * Retro page's format picker (Custom) or by an agent (tool.retro.start with
 * `columns`). Pure, with no browser globals: the picker, its saved list and
 * the agent actions share it.
 *
 * A custom format is an ordinary RetroFormat, so the board, Past retros,
 * share links, the Markdown export and the live room treat it like any
 * other. Its id starts with "custom-", which no built-in format uses. Its
 * column keys are made from the names, so a column called "Glad" or "Keep"
 * still takes the cards a hand-off sends there. Its colours come from the
 * app's own palette in order, never from anything typed, saved or synced.
 *
 * What the picker saves in the browser is the draft (a name and the column
 * names) under its id: `customFormatFrom` rebuilds the same format from it
 * every time.
 */

import { nanoid } from "nanoid";
import { listAnd } from "@/lib/charts/chart-text";
import { RETRO_COLUMN_PALETTE, type RetroFormat } from "@/lib/constants/retro-formats";
import type { Validation } from "@/lib/utils/form";

/** Every custom format's id starts with this; no built-in one does. */
export const CUSTOM_FORMAT_PREFIX = "custom-";
/** Fewest columns a custom format has. */
export const CUSTOM_COLUMNS_MIN = 2;
/** Most columns a custom format has. */
export const CUSTOM_COLUMNS_MAX = 6;
/** Longest column name. */
export const CUSTOM_LABEL_MAX = 40;
/** Longest format name. */
export const CUSTOM_NAME_MAX = 60;
/**
 * Most custom formats saving keeps: saving one more drops the one used
 * longest ago, and the picker names it, with Undo.
 */
export const SAVED_CUSTOM_MAX = 12;
/**
 * Most entries read back from the browser: a guard against a hand-edited or
 * synced list. Undo of a delete can leave the list above SAVED_CUSTOM_MAX
 * until the next save, rather than drop another format unannounced.
 */
export const SAVED_CUSTOM_READ_MAX = SAVED_CUSTOM_MAX * 2;
/** Longest column key made from a name (the room and share links take 64). */
const KEY_MAX = 40;

/** What the Custom form holds, and what the browser saves. */
export interface CustomFormatDraft {
  name: string;
  columns: string[];
}

/** A custom format kept in the browser for next time. */
export interface SavedCustomFormat extends CustomFormatDraft {
  id: string;
}

/** The form's fields: the name, the column list as a whole, and each column. */
export type CustomFormatField = "name" | "columns" | `column${number}`;

/** One line of text: whitespace collapsed, trimmed. */
const oneLine = (s: unknown): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

/**
 * A draft checked for saving: a name of up to 60 characters, and 2 to 6
 * columns, each named (up to 40 characters) and named differently from the
 * others, ignoring case. The values come back trimmed.
 */
export function validateCustomFormat(
  draft: CustomFormatDraft
): Validation<CustomFormatDraft, CustomFormatField> {
  const errors: Partial<Record<CustomFormatField, string>> = {};
  const name = oneLine(draft.name);
  if (!name) errors.name = "Name the format.";
  else if (name.length > CUSTOM_NAME_MAX) {
    errors.name = `Keep the name to ${CUSTOM_NAME_MAX} characters.`;
  }
  const raw = Array.isArray(draft.columns) ? draft.columns : [];
  if (raw.length < CUSTOM_COLUMNS_MIN || raw.length > CUSTOM_COLUMNS_MAX) {
    errors.columns = `Give it ${CUSTOM_COLUMNS_MIN} to ${CUSTOM_COLUMNS_MAX} columns.`;
  }
  const columns = raw.map(oneLine);
  const seen = new Set<string>();
  columns.forEach((label, i) => {
    const key: CustomFormatField = `column${i}`;
    if (!label) errors[key] = "Name this column.";
    else if (label.length > CUSTOM_LABEL_MAX) {
      errors[key] = `Keep it to ${CUSTOM_LABEL_MAX} characters.`;
    } else if (seen.has(label.toLowerCase())) {
      errors[key] = "Give each column its own name.";
    }
    seen.add(label.toLowerCase());
  });
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values: { name, columns } };
}

/** A fresh id for a custom format. */
export function newCustomFormatId(): string {
  return `${CUSTOM_FORMAT_PREFIX}${nanoid(10)}`;
}

/** Whether `id` names a custom format. */
export function isCustomFormatId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(CUSTOM_FORMAT_PREFIX) && id.length <= 64;
}

/** "Went well!" → "went-well"; "" when no letter or digit is left. */
export function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_MAX)
    .replace(/-+$/, "");
}

/**
 * A column key for each name, in order: the name in lower case with dashes
 * ("Went well" → "went-well"), "column-3" for a name with no Latin letter
 * or digit, and "-2", "-3" added to a key already taken.
 */
export function customColumnKeys(labels: readonly string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label, i) => {
    const base = slug(label) || `column-${i + 1}`;
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    taken.add(key);
    return key;
  });
}

/**
 * The format for a checked draft under `id`: its columns keyed from their
 * names and coloured from the app's palette in order, with no icons.
 */
export function customFormatFrom(values: CustomFormatDraft, id: string): RetroFormat {
  const keys = customColumnKeys(values.columns);
  return {
    id,
    name: values.name,
    description: `Your own columns: ${listAnd(values.columns)}.`,
    columns: values.columns.map((label, i) => ({
      key: keys[i],
      label,
      color: RETRO_COLUMN_PALETTE[i % RETRO_COLUMN_PALETTE.length],
      icon: "",
    })),
  };
}

/** Whether two drafts have the same name and columns, ignoring case. */
function sameDraft(a: CustomFormatDraft, b: CustomFormatDraft): boolean {
  const flat = (d: CustomFormatDraft) =>
    [d.name, ...d.columns].map((s) => oneLine(s).toLowerCase()).join("\u0000");
  return flat(a) === flat(b);
}

/**
 * The saved list as the picker shows it, from whatever the browser (or a
 * synced copy) holds: valid entries only, each id once, most recently used
 * first, at most SAVED_CUSTOM_READ_MAX.
 */
export function normalizeSavedFormats(raw: unknown): SavedCustomFormat[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedCustomFormat[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (out.length >= SAVED_CUSTOM_READ_MAX) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!isCustomFormatId(e.id) || ids.has(e.id)) continue;
    const columns = Array.isArray(e.columns) ? e.columns : [];
    if (!columns.every((c) => typeof c === "string")) continue;
    const checked = validateCustomFormat({
      name: typeof e.name === "string" ? e.name : "",
      columns: columns as string[],
    });
    if (!checked.ok) continue;
    ids.add(e.id);
    out.push({ id: e.id, ...checked.values });
  }
  return out;
}

/**
 * The saved list with `values` at the front. The same name and columns
 * saved before keep their id and move up instead of being saved twice.
 * Past SAVED_CUSTOM_MAX the last ones (used longest ago) drop off. Returns
 * the list, the id the format is saved under, and the ones that dropped
 * off, for the picker to name.
 */
export function withSavedFormat(
  list: readonly SavedCustomFormat[],
  values: CustomFormatDraft,
  newId: () => string = newCustomFormatId
): { list: SavedCustomFormat[]; id: string; dropped: SavedCustomFormat[] } {
  const twin = list.find((f) => sameDraft(f, values));
  const id = twin?.id ?? newId();
  const rest = list.filter((f) => f.id !== id);
  const all = [{ id, name: values.name, columns: [...values.columns] }, ...rest];
  return { list: all.slice(0, SAVED_CUSTOM_MAX), id, dropped: all.slice(SAVED_CUSTOM_MAX) };
}

/**
 * The saved list with `format`, deleted from `before`, put back where it
 * was: in front of the first of the ones after it that are still saved,
 * else at the end. Nothing else drops off for it.
 */
export function withRestoredFormat(
  list: readonly SavedCustomFormat[],
  format: SavedCustomFormat,
  before: readonly SavedCustomFormat[]
): SavedCustomFormat[] {
  if (list.some((f) => f.id === format.id)) return [...list];
  const at = before.findIndex((f) => f.id === format.id);
  for (const after of before.slice(at + 1)) {
    const i = list.findIndex((f) => f.id === after.id);
    if (i >= 0) return [...list.slice(0, i), format, ...list.slice(i)];
  }
  return [...list, format];
}

/** The saved list with format `id` moved to the front: the one used last. */
export function savedFirst(list: readonly SavedCustomFormat[], id: string): SavedCustomFormat[] {
  const picked = list.find((f) => f.id === id);
  return picked ? [picked, ...list.filter((f) => f.id !== id)] : [...list];
}
