/**
 * A tool step's arguments and result in words, for the owner's Details on
 * the step (chat/step-details): `Text: “flaky CI”`, `Added: yes`, `Cards: 12
 * items`. Never JSON, a key as written in code or a record's id: a field
 * holding ids is left out (a list of them is counted), an object's own fields
 * stand in for it one level down, and a lower-case code word reads as words
 * ("went-well" is "Went well"). An error says what went wrong in a sentence.
 *
 * Owner-only: only the owner's chat imports it (through chat/step-details,
 * which agent-conversation hands to the strip), so a visitor's chat never
 * carries it, nor anything it shows (test/agent/bundle-boundary.test.ts).
 * Pure, with no registry import.
 */

import { phrase } from "./tool-label";
import { classifyResult, isPartialInput, resultText } from "./tool-result-text";
import type { ToolResultBlock, ToolUseBlock } from "./types";

/** One field in words. */
export interface DetailLine {
  name: string;
  value: string;
}

/** What Details shows for the arguments or the result. */
export interface Detail {
  /** Each field in words, at most DETAIL_LINES. */
  lines: DetailLine[];
  /** How many fields there were past those lines. */
  more: number;
  /** A sentence in place of fields, when there are none to show ("Nothing came back."). */
  note: string | null;
}

/** The most fields Details lists; the rest are counted. */
export const DETAIL_LINES = 8;
/** The longest a quoted value or a sentence runs before it is cut, in characters. */
const VALUE_MAX = 80;
/** The most items of a short list said one by one; a longer one is counted. */
const LIST_MAX = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A code word with a joiner in it: "went-well", "no_retro". Free text and a plain word aren't. */
const CODE_WORD = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;

/** What each way a call can end without running says, in a sentence. */
const ENDED: Readonly<Record<string, string>> = {
  denied: "It didn't run.",
  unavailable: "It isn't available here, so it didn't run.",
  stopped: "It was stopped before it finished.",
  timeout: "It took too long, so it was stopped.",
};

const note = (text: string): Detail => ({ lines: [], more: 0, note: text });

/** Text cut to `max` characters at most, with an ellipsis when cut. */
function cut(text: string, max = VALUE_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A key's words: "columnKey" → column, key; "item_ids" → item, ids. */
function keyWords(key: string): string[] {
  return (
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}

/** A key in words: "columnKey" → "Column", "capacityPoints" → "Capacity points". */
function keyName(key: string): string {
  const words = keyWords(key);
  // "Key" says nothing a person needs ("columnKey" is the column).
  if (words.length > 1 && words[words.length - 1] === "key") words.pop();
  return phrase(words);
}

/** A field that holds a record's id or a list of them: "id", "sprintId", "ids", "item_ids". */
const isIdKey = (key: string) => /^ids?$/i.test(key) || /(?:Ids?|IDs?|_ids?)$/.test(key);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One value in words; "" to leave it out (an id, an object too deep to say). */
function valueWords(value: unknown): string {
  if (value === null) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") {
    const text = value.trim();
    if (UUID.test(text)) return "";
    if (CODE_WORD.test(text)) return phrase(text.split(/[-_]/));
    return text ? `“${cut(text)}”` : "empty";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    const short = value.length <= LIST_MAX && value.every((v) => typeof v !== "object");
    const words = short ? value.map(valueWords).filter(Boolean) : [];
    if (words.length === value.length) return words.join(", ");
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  return "";
}

/** An object's fields in words, its objects' fields one level down. */
function linesOf(value: Record<string, unknown>, nested = false): DetailLine[] {
  const out: DetailLine[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (key.startsWith("_")) continue;
    if (isIdKey(key)) {
      if (Array.isArray(field) && field.length > 0) {
        out.push({ name: "Items", value: String(field.length) });
      }
      continue;
    }
    if (isObject(field)) {
      if (!nested) out.push(...linesOf(field, true));
      continue;
    }
    const words = valueWords(field);
    const name = keyName(key);
    if (words && name) out.push({ name, value: words });
  }
  return out;
}

/** An object's fields as a detail, or `empty` when none are left to show. */
function fieldsDetail(value: Record<string, unknown>, empty: string): Detail {
  const lines = linesOf(value);
  if (lines.length === 0) return note(empty);
  return {
    lines: lines.slice(0, DETAIL_LINES),
    more: Math.max(0, lines.length - DETAIL_LINES),
    note: null,
  };
}

/** The arguments a call was made with, in words. */
export function inputDetail(input: ToolUseBlock["input"] | null | undefined): Detail {
  if (isPartialInput(input)) return note("Its arguments never arrived whole.");
  if (!isObject(input)) return note("It took no arguments.");
  // A saved thread keeps a long call's arguments only cut short.
  if ("_truncated" in input) return note("Its arguments were too long to keep in the saved chat.");
  if (Object.keys(input).length === 0) return note("It took no arguments.");
  return fieldsDetail(input, "Only record ids, left out here.");
}

/** What a call came back with, in words: its fields, or a sentence. */
export function resultDetail(result: Pick<ToolResultBlock, "content" | "is_error">): Detail {
  const status = classifyResult(result);
  if (ENDED[status]) return note(ENDED[status]);
  const text = resultText(result).trim();
  if (status === "failed") {
    const handler = /^Handler error:\s*([\s\S]+)$/.exec(text);
    if (handler) return note(cut(handler[1]));
    if (/^(?:Invalid input for|Input too large|Input is not JSON)/.test(text)) {
      return note("Its arguments didn't fit what the tool takes.");
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return note(text ? cut(text) : "Nothing came back.");
  }
  if (value === null) return note("Nothing came back.");
  if (isObject(value)) return fieldsDetail(value, "Only record ids came back.");
  const words = valueWords(value);
  return note(words ? `It came back with ${words}.` : "Nothing came back.");
}
