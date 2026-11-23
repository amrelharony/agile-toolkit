/**
 * Finding the actions, decisions, blockers, bugs, stories and open
 * questions in pasted meeting notes, without AI (`extractByRules`, the AI
 * task's fallback), and checking what the AI found against the notes
 * themselves (`groundedItems`): an item whose quote isn't in the notes is
 * dropped, an owner is kept only when they are on the team or named in the
 * notes, and a due date only when it is a real day on or after the
 * meeting. Pure and server-safe: the page, the AI fallback and Amr's
 * find_items verb all read it.
 */

import { routeByRules } from "@/lib/parking-lot/route-rules";
import { findRosterMember } from "@/lib/team/names";
import { MEETING_NOTE_ITEM_KINDS, type MeetingNoteItemKind } from "@/lib/stores/workspace-types";
import { dueFromText, isDay } from "./due";

/** At most this many items per ask: a meeting's worth. */
export const FOUND_MAX = 20;
export const FOUND_TEXT_MAX = 200;
export const FOUND_DETAIL_MAX = 300;
export const FOUND_OWNER_MAX = 60;
export const FOUND_QUOTE_MAX = 200;

/** One item found in the notes, before anyone keeps it. */
export interface FoundItem {
  kind: MeetingNoteItemKind;
  text: string;
  detail?: string;
  owner?: string;
  due?: string;
  /** The line of the notes it came from. */
  quote: string;
}

export interface ExtractInput {
  notes: string;
  meeting?: string;
  /** The meeting's day, YYYY-MM-DD: due dates count from it. */
  date: string;
  /** The running sprint's last day, for "end of sprint". */
  sprintEnd?: string;
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Text compared the way a quote is checked: lower case, one space, plain quotes and dashes. */
export function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** A bullet, number or checkbox at the start of a line, kept apart from its words. */
const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;
const CHECKBOX = /^\s*\[\s?\]\s*/;

/** The notes as lines, and long lines as sentences: each a place an item can come from. */
export function noteLines(notes: string): string[] {
  const out: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z@[])/)) {
      const s = sentence.trim();
      if (s.length >= 3) out.push(s);
    }
  }
  return out;
}

/** Words a capitalised first word can be that aren't a person's name. */
const NOT_A_NAME = new Set(
  [
    "we",
    "i",
    "you",
    "they",
    "team",
    "everyone",
    "someone",
    "nobody",
    "need",
    "needs",
    "should",
    "the",
    "this",
    "that",
    "it",
    "who",
    "what",
    "how",
    "do",
    "does",
    "action",
    "todo",
    "decision",
    "decided",
    "agreed",
    "bug",
    "q",
    "next",
    "also",
    "and",
  ].map((w) => w.toLowerCase())
);

const NAME = "[A-Z][\\p{L}'’-]{1,30}";
const TO_VERB = new RegExp(`^(${NAME})(?: and (${NAME}))? (?:to|will) [a-z]`, "u");
const AT_NAME = new RegExp("@(\\p{L}[\\p{L}'’.-]{0,40})", "u");

/** The person a line gives the work to, as written: "Ana to …", "Ana will …", "@Ana". */
function ownerIn(line: string): string | undefined {
  const at = AT_NAME.exec(line);
  if (at) return at[1].replace(/[.]+$/, "");
  const m = TO_VERB.exec(line);
  if (m && !NOT_A_NAME.has(m[1].toLowerCase())) return m[1];
  return undefined;
}

/** Something that "went down well" was liked: no blocker in it. */
const DOWN_WELL = /\b(?:went|go(?:es|ne|ing)?) down (?:really |very )?well\b/gi;

interface Rule {
  kind: MeetingNoteItemKind;
  /** Whether the line is this kind. */
  test: (line: string) => boolean;
  /** A marker to take off the front of the line for the item's words. */
  strip?: RegExp;
}

const RULES: readonly Rule[] = [
  {
    kind: "decision",
    test: (l) => /^\s*decision\s*:|\b(decided|agreed|we'?ll go with|we will go with)\b/i.test(l),
    strip: /^\s*(?:decision|decided|agreed)\s*:?\s*/i,
  },
  {
    kind: "action",
    test: (l) =>
      CHECKBOX.test(l) ||
      /^\s*(?:action(?: item)?|todo|to do|ai)\s*:/i.test(l) ||
      /^\s*todo\b/i.test(l),
    strip: /^\s*(?:\[\s?\]\s*|(?:action(?: item)?|todo|to do|ai)\s*:?\s*)/i,
  },
  {
    kind: "question",
    test: (l) => /\?\s*$/.test(l) || /^\s*q\s*:/i.test(l),
    strip: /^\s*q\s*:\s*/i,
  },
  {
    kind: "action",
    test: (l) => ownerIn(l) !== undefined,
  },
  {
    kind: "impediment",
    // "Went down well" is praise, not an outage: the phrase is taken out
    // before Parking Lot's blocker words are read.
    test: (l) =>
      /\bblocked\b/i.test(l) || routeByRules(l.replace(DOWN_WELL, "")).destination === "impediment",
    strip: /^\s*(?:blocker|impediment|blocked)\s*:\s*/i,
  },
  {
    kind: "bug",
    test: (l) =>
      /^\s*bug\s*:|\b(broken|crash(?:es|ed|ing)?|error when|errors? on|cuts? off|doesn'?t work|not working|fails? (?:when|on|to))\b/i.test(
        l
      ),
    strip: /^\s*bug\s*:\s*/i,
  },
  {
    kind: "story",
    test: (l) =>
      /\b(we need to build|need to add|add an? |feature request|users? (?:want|need|asked))\b/i.test(
        l
      ),
    strip: /^\s*(?:feature request|story)\s*:\s*/i,
  },
];

/** A line's words as an item: the marker off, the first letter up, within the cap. */
function itemText(line: string, strip?: RegExp): string {
  const t = (strip ? line.replace(strip, "") : line).replace(CHECKBOX, "").trim();
  const words = t || line.trim();
  return cut(words.charAt(0).toUpperCase() + words.slice(1), FOUND_TEXT_MAX);
}

/**
 * The items the keyword rules find, in the notes' order, one per line or
 * sentence at most, up to FOUND_MAX: an action ("Action:", "TODO", "[ ]",
 * "Ana to …", "Ana will …", "@Ana"), a decision ("Decided", "agreed",
 * "Decision:", "we'll go with"), a blocker (Parking Lot's impediment words,
 * "blocked"), a bug ("Bug:", "broken", "crash", "error when", "cuts off"),
 * a story ("we need to build", "add a", "feature request") or a question
 * (a closing "?", "Q:"). Owners come from the notes as written; due dates
 * count from the meeting's day.
 */
export function extractByRules(input: ExtractInput): FoundItem[] {
  const out: FoundItem[] = [];
  const seen = new Set<string>();
  for (const line of noteLines(input.notes)) {
    if (out.length >= FOUND_MAX) break;
    const rule = RULES.find((r) => r.test(line));
    if (!rule) continue;
    const text = itemText(line, rule.strip);
    const key = `${rule.kind}:${normalized(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = rule.kind === "action" ? ownerIn(line) : undefined;
    const due =
      rule.kind === "action" || rule.kind === "story" || rule.kind === "bug"
        ? dueFromText(line, input.date, { sprintEnd: input.sprintEnd })
        : undefined;
    out.push({
      kind: rule.kind,
      text,
      ...(owner ? { owner: cut(owner, FOUND_OWNER_MAX) } : {}),
      ...(due ? { due } : {}),
      // Cut without an ellipsis, so the quote is still a piece of the notes.
      quote: line.slice(0, FOUND_QUOTE_MAX).trim(),
    });
  }
  return out;
}

export interface GroundOptions {
  /** The team's names: an owner on the roster gets its spelling. */
  roster?: readonly { name: string }[];
  /** The meeting's day: a due date before it is dropped. */
  date: string;
}

/** Whether `name` appears in the notes as a word (any case). */
function namedIn(notes: string, name: string): boolean {
  const n = normalized(name);
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, "u").test(normalized(notes));
}

/**
 * What the AI found, checked against the notes: an item whose quote isn't
 * in them is dropped (case, spacing, curly quotes and dashes aside), and so
 * is an unknown kind or a repeat; an owner is kept only when they are on
 * the roster (with its spelling) or named in the notes; a due date only
 * when it is a real day on or after the meeting. Capped at FOUND_MAX.
 */
export function groundedItems(
  items: readonly FoundItem[],
  notes: string,
  opts: GroundOptions
): FoundItem[] {
  const haystack = normalized(notes);
  const out: FoundItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (out.length >= FOUND_MAX) break;
    if (!(MEETING_NOTE_ITEM_KINDS as readonly string[]).includes(item.kind)) continue;
    const text = (item.text ?? "").trim();
    // A quote cut short (an ellipsis at its end) is checked up to the cut.
    const quote = (item.quote ?? "")
      .trim()
      .replace(/(?:…|\.\.\.)$/, "")
      .trim();
    if (!text || !quote || !haystack.includes(normalized(quote))) continue;
    const key = `${item.kind}:${normalized(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rawOwner = (item.owner ?? "").trim();
    const member = rawOwner ? findRosterMember(opts.roster ?? [], rawOwner) : undefined;
    const owner = member
      ? member.name
      : rawOwner && namedIn(notes, rawOwner)
        ? rawOwner
        : undefined;
    const due = isDay(item.due) && item.due >= opts.date ? item.due : undefined;
    const detail = (item.detail ?? "").trim();
    out.push({
      kind: item.kind,
      text: cut(text, FOUND_TEXT_MAX),
      ...(detail ? { detail: cut(detail, FOUND_DETAIL_MAX) } : {}),
      ...(owner ? { owner: cut(owner, FOUND_OWNER_MAX) } : {}),
      ...(due ? { due } : {}),
      quote: quote.slice(0, FOUND_QUOTE_MAX),
    });
  }
  return out;
}
