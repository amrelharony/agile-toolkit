/**
 * The Scrum Master Notebook's model: a coach's own dated notes on the team
 * (workspace.notebookEntries, NotebookEntry), tagged, from a Scrum event,
 * about a tool. Pure, no React and no client module, so the page, Amr's
 * actions (tool.sm_notebook, browser and MCP) and the AI fallbacks read the
 * notes the same way.
 *
 *   - tags are counted trimmed, lower case and with single spaces;
 *   - weeks start on Monday ("YYYY-MM-DD" local days, no time zone);
 *   - a note tagged SUMMARY_TAG is a kept weekly summary: it is a note like
 *     any other, but a week's counts and Amr's weekly read leave it out, so a
 *     summary never counts itself.
 */

import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type NotebookEntry,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import type { HandoffSource } from "@/lib/handoffs/types";

/** The tool's registry id, and the `sourceRef.tool` a sent note carries. */
export const NOTEBOOK_TOOL_ID = "sm-notebook";

/** A note's text caps: the workspace schema's, so a note the page saved is one an agent can update. */
export const NOTE_TITLE_MAX = TOOL_TEXT_MAX.short;
export const NOTE_BODY_MAX = TOOL_TEXT_MAX.long;
export const NOTE_TAG_MAX = TOOL_TEXT_MAX.short;
export const NOTE_TAGS_MAX = TOOL_LIST_MAX.tags;
export const NOTE_EVENT_MAX = TOOL_TEXT_MAX.short;

/** The tag a kept weekly summary carries. */
export const SUMMARY_TAG = "weekly-summary";

/**
 * Tags that say what kind of note it is rather than what it is about: never
 * a theme, a pattern or a reason to suggest a tool.
 */
export const KIND_TAGS: ReadonlySet<string> = new Set([SUMMARY_TAG, "observation", "1:1"]);

/** The Scrum events (and the other places a coach notices things) a note can come from. */
export const NOTEBOOK_EVENTS = [
  { id: "sprint-planning", label: "Sprint Planning" },
  { id: "daily-scrum", label: "Daily Scrum" },
  { id: "refinement", label: "Refinement" },
  { id: "sprint-review", label: "Sprint Review" },
  { id: "retro", label: "Retrospective" },
  { id: "one-on-one", label: "1:1" },
  { id: "day-to-day", label: "Day to day" },
] as const;

export type NotebookEventId = (typeof NOTEBOOK_EVENTS)[number]["id"];

const EVENT_LABEL: ReadonlyMap<string, string> = new Map(
  NOTEBOOK_EVENTS.map((e) => [e.id, e.label])
);

/** Whether `id` is one of the events the page offers. */
export const isKnownEvent = (id: string | undefined | null): id is NotebookEventId =>
  typeof id === "string" && EVENT_LABEL.has(id);

/** Text on one line, with runs of spaces closed up. */
export const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** "Ab…" for text longer than `max` characters. */
export function clip(s: string, max: number): string {
  const t = oneLine(s);
  if (t.length <= max) return t;
  return max <= 1 ? t.slice(0, max) : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * An event as people read it: "Daily Scrum" for a known id, the text itself
 * (on one line, cut short) for one an agent typed, "" for none.
 */
export function eventLabel(id: string | undefined | null): string {
  if (!id || !id.trim()) return "";
  return EVENT_LABEL.get(id) ?? clip(id, 40);
}

/** A tag as it is counted: trimmed, lower case, single spaces. */
export const normTag = (tag: string): string => oneLine(tag).toLowerCase();

/** Tags as stored: normalised, blanks dropped, each once, in the order given. */
export function normTags(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const n = normTag(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** "Blockers,  UX , blockers" → ["blockers", "ux"]. */
export const parseTags = (input: string): string[] => normTags(input.split(","));

/** Whether a note is a kept weekly summary. */
export const isSummaryNote = (e: Pick<NotebookEntry, "tags">): boolean =>
  normTags(e.tags ?? []).includes(SUMMARY_TAG);

/** What a note is called in lists: its title, else its first line, cut short. */
export function noteName(e: Pick<NotebookEntry, "title" | "body">, max = 80): string {
  const title = oneLine(e.title ?? "");
  if (title) return clip(title, max);
  const first = (e.body ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  return clip(first, max) || "Untitled note";
}

/* ── Reading the stored notes ─────────────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `s` looks like a day, YYYY-MM-DD: what the workspace schema checks,
 * so an agent can store "2026-02-30".
 */
export const isDayShaped = (s: unknown): s is string => typeof s === "string" && DAY.test(s);

/** Whether `s` is a real calendar day ("2026-02-30" isn't). */
export function isDay(s: unknown): s is string {
  if (!isDayShaped(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** A stored hand-off link the page can use: a route and a target, as text. */
function asLink(v: unknown): HandoffLink | null {
  if (!v || typeof v !== "object") return null;
  const l = v as Record<string, unknown>;
  if (typeof l.route !== "string" || !l.route || typeof l.targetId !== "string" || !l.targetId) {
    return null;
  }
  return {
    route: l.route as HandoffLink["route"],
    targetId: l.targetId,
    at: typeof l.at === "string" ? l.at : "",
  };
}

/**
 * The notes as the page can show them. Synced rows are read back as they
 * were stored, so anything without an id, a day's shape or a body is left
 * out, tags that aren't text are dropped, optional fields that aren't text
 * go, and so do hand-off links without a route and a target. A day the
 * calendar doesn't have ("2026-02-30", which the workspace schema lets an
 * agent store) is kept as written, so the note can still be seen, fixed and
 * deleted; it is filed under its month's nearest day (calendarDay).
 */
export function normalizeEntries(raw: readonly unknown[] | null | undefined): NotebookEntry[] {
  const out: NotebookEntry[] = [];
  for (const r of raw ?? []) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id || typeof e.body !== "string" || !isDayShaped(e.date)) {
      continue;
    }
    const title = str(e.title);
    const event = str(e.event);
    const linkedTool = str(e.linkedTool);
    out.push({
      id: e.id,
      date: e.date,
      body: e.body,
      tags: Array.isArray(e.tags) ? normTags(e.tags) : [],
      ...(title ? { title } : {}),
      ...(event ? { event } : {}),
      ...(linkedTool ? { linkedTool } : {}),
      ...(Array.isArray(e.sentTo)
        ? { sentTo: e.sentTo.map(asLink).filter((l): l is HandoffLink => l !== null) }
        : {}),
      createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : "",
    });
  }
  return out;
}

/** Newest day first; on one day, the note written last first. */
export function compareNotes(a: NotebookEntry, b: NotebookEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ac = a.createdAt ?? "";
  const bc = b.createdAt ?? "";
  if (ac !== bc) return ac < bc ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The notes that aren't the example's. */
export const realNotes = (entries: readonly NotebookEntry[]): NotebookEntry[] =>
  entries.filter((e) => !isExampleId(e.id));

/* ── Days and weeks ───────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * `day` at midnight UTC. A day the calendar doesn't have is read as the
 * nearest one in its month ("2026-02-30" as 28 Feb, "2026-13-05" as
 * 5 Dec), so it never rolls into another month or breaks a date.
 */
const utc = (day: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  const month = Math.min(12, Math.max(1, m || 1));
  const t = new Date(0);
  t.setUTCFullYear(y, month, 0); // the month's last day
  t.setUTCFullYear(y, month - 1, Math.min(t.getUTCDate(), Math.max(1, d || 1)));
  return t;
};
const iso = (t: Date): string => t.toISOString().slice(0, 10);

/** The real day a stored day is filed under: itself, or its month's nearest ("2026-02-30" → "2026-02-28"). */
export const calendarDay = (day: string): string => (isDay(day) ? day : iso(utc(day)));

/** The day `n` days after `day` (before, when negative). `day` must have a day's shape. */
export const shiftDay = (day: string, n: number): string =>
  iso(new Date(utc(day).getTime() + Math.trunc(n) * DAY_MS));

/** The Monday of `day`'s week. */
export function weekStartOf(day: string): string {
  const back = (utc(day).getUTCDay() + 6) % 7;
  return shiftDay(day, -back);
}

/** The Sunday of the week starting `weekStart`. */
export const weekEndOf = (weekStart: string): string => shiftDay(weekStart, 6);

/** Whether `day` falls in the week starting `weekStart`. */
export function inWeek(day: string, weekStart: string): boolean {
  const d = calendarDay(day);
  return d >= weekStart && d <= weekEndOf(weekStart);
}

/** "9 Nov 2026". */
export function formatDay(day: string): string {
  if (!isDay(day)) return day;
  const t = utc(day);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** "Thu 12 Nov". */
export function formatShortDay(day: string): string {
  if (!isDay(day)) return day;
  const t = utc(day);
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/** "Week of 9 Nov 2026". */
export const weekLabel = (weekStart: string): string => `Week of ${formatDay(weekStart)}`;

export interface NoteWeek {
  weekStart: string;
  notes: NotebookEntry[];
}

/** The notes grouped by week, newest week first, each newest note first. */
export function groupByWeek(entries: readonly NotebookEntry[]): NoteWeek[] {
  const weeks = new Map<string, NotebookEntry[]>();
  for (const e of [...entries].sort(compareNotes)) {
    const start = weekStartOf(e.date);
    const list = weeks.get(start);
    if (list) list.push(e);
    else weeks.set(start, [e]);
  }
  return Array.from(weeks, ([weekStart, notes]) => ({ weekStart, notes }));
}

/** A week's notes, newest first, with its kept summaries apart. */
export function notesOfWeek(
  entries: readonly NotebookEntry[],
  weekStart: string
): { notes: NotebookEntry[]; summaries: NotebookEntry[] } {
  const week = entries.filter((e) => inWeek(e.date, weekStart)).sort(compareNotes);
  return {
    notes: week.filter((e) => !isSummaryNote(e)),
    summaries: week.filter(isSummaryNote),
  };
}

/* ── Counts ───────────────────────────────────────────────────────── */

export interface TagCount {
  tag: string;
  count: number;
}

/** How many notes carry each tag, most first, then A to Z. Kind tags count too. */
export function tagCounts(entries: readonly NotebookEntry[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const t of normTags(e.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
}

export interface EventCount {
  event: string;
  label: string;
  count: number;
}

/** How many notes came from each event, most first, then in the events' order. Notes with none aren't counted. */
export function eventCounts(entries: readonly Pick<NotebookEntry, "event">[]): EventCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const ev = e.event?.trim();
    if (ev) counts.set(ev, (counts.get(ev) ?? 0) + 1);
  }
  const order = (id: string) => {
    const i = NOTEBOOK_EVENTS.findIndex((x) => x.id === id);
    return i < 0 ? NOTEBOOK_EVENTS.length : i;
  };
  return Array.from(counts, ([event, count]) => ({ event, label: eventLabel(event), count })).sort(
    (a, b) => b.count - a.count || order(a.event) - order(b.event) || a.label.localeCompare(b.label)
  );
}

/* ── Search and filters ───────────────────────────────────────────── */

export interface NoteFilter {
  /** Words that must all appear in the title, body, tags, event or linked tool. */
  query?: string;
  /** Tags the note must all carry. */
  tags?: readonly string[];
  /** The event it came from. */
  event?: string | null;
  /** First and last day, both included. */
  from?: string;
  to?: string;
}

/** The text a search reads for a note. `toolName` names a linked tool ("Impediment Tracker"). */
function searchText(e: NotebookEntry, toolName?: (id: string) => string | undefined): string {
  const linked = e.linkedTool ? (toolName?.(e.linkedTool) ?? e.linkedTool) : "";
  return [
    e.title ?? "",
    e.body,
    (e.tags ?? []).join(" "),
    eventLabel(e.event),
    e.event ?? "",
    linked,
  ]
    .join(" ")
    .toLowerCase();
}

/** Whether a note passes the filter. */
export function matchesFilter(
  e: NotebookEntry,
  filter: NoteFilter,
  toolName?: (id: string) => string | undefined
): boolean {
  if (filter.event && e.event !== filter.event) return false;
  if (filter.from && e.date < filter.from) return false;
  if (filter.to && e.date > filter.to) return false;
  const wanted = normTags(filter.tags ?? []);
  if (wanted.length > 0) {
    const own = normTags(e.tags ?? []);
    if (!wanted.every((t) => own.includes(t))) return false;
  }
  const words = oneLine(filter.query ?? "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(e, toolName);
  return words.every((w) => text.includes(w));
}

/** The notes that pass, newest first. */
export function filterNotes(
  entries: readonly NotebookEntry[],
  filter: NoteFilter,
  toolName?: (id: string) => string | undefined
): NotebookEntry[] {
  return entries.filter((e) => matchesFilter(e, filter, toolName)).sort(compareNotes);
}

/* ── Sending a note on ────────────────────────────────────────────── */

/** Where a note can go: an impediment to remove, or an action for the retro. */
export const NOTE_ROUTES = ["impediment", "retro-action"] as const;

/** What a send hands over: the note's name, its text, and the way back to it. */
export function noteHandoffSource(e: NotebookEntry): HandoffSource {
  return {
    title: noteName(e, 120),
    description: e.body.trim().slice(0, 4000),
    sourceRef: { tool: NOTEBOOK_TOOL_ID, id: e.id },
  };
}

/** The links `next` has that `prev` didn't: what a send just added. */
export function addedLinks(
  prev: readonly HandoffLink[] | undefined,
  next: readonly HandoffLink[] | undefined
): HandoffLink[] {
  const key = (l: HandoffLink) => `${l.route}\u0000${l.targetId}`;
  const had = new Set((prev ?? []).map(key));
  return (next ?? []).filter((l) => !had.has(key(l)));
}
