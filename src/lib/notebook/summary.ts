/**
 * A week of notes read together: what goes to Amr's AI for the weekly
 * summary (`weeklyInput`, cut to fit the AI route), and the same read
 * without AI (`weeklyFallback`): the counts, the themes that came up more
 * than once (tags and keyword themes), and the tools for those themes.
 * Pure: the AI task's fallback and Amr's `weekly_summary` read call it.
 */

import type { NotebookEntry } from "@/lib/stores/workspace-types";
import {
  clip,
  compareNotes,
  eventCounts,
  formatDay,
  inWeek,
  isSummaryNote,
  normTags,
  oneLine,
} from "./model";
import { themeCounts, themeOf } from "./themes";

/** The most notes a weekly read takes: the week's newest. */
export const WEEKLY_MAX_NOTES = 60;
/** Each note's text in a weekly read, at most. */
export const WEEKLY_BODY_MAX = 800;
export const WEEKLY_TITLE_MAX = 120;
export const WEEKLY_TAG_MAX = 40;
export const WEEKLY_TAGS_MAX = 8;
export const WEEKLY_EVENT_MAX = 40;
export const WEEKLY_TOOL_MAX = 60;
/** The answer's caps. */
export const WEEKLY_SUMMARY_MAX = 1200;
export const WEEKLY_PATTERNS_MAX = 5;
export const WEEKLY_PATTERN_MAX = 280;
export const WEEKLY_TOOLS_MAX = 5;
export const WEEKLY_WHY_MAX = 200;

/**
 * What a weekly read may send in all. The server cuts its prompt's data at
 * 48,000 characters and a visitor's request at 64 KiB, so the notes are cut
 * shorter until they fit well inside both.
 */
export const WEEKLY_CHAR_BUDGET = 36_000;
export const WEEKLY_BYTE_BUDGET = 56_000;

/** One note as a weekly read sees it. */
export interface WeeklyNote {
  date: string;
  title?: string;
  body: string;
  tags: string[];
  event?: string;
  linkedTool?: string;
}

export interface WeeklyInput {
  /** The Monday of the week. */
  weekStart: string;
  notes: WeeklyNote[];
}

export interface WeeklyOutput {
  summary: string;
  patterns: string[];
  tools: { id: string; why: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function cutTo(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** How much of each field a weekly read keeps. */
interface NoteCaps {
  body: number;
  title: number;
  /** Each tag, and how many. */
  tag: number;
  tags: number;
  event: number;
}

const FULL_CAPS: NoteCaps = {
  body: WEEKLY_BODY_MAX,
  title: WEEKLY_TITLE_MAX,
  tag: WEEKLY_TAG_MAX,
  tags: WEEKLY_TAGS_MAX,
  event: WEEKLY_EVENT_MAX,
};
/** The shortest a note's text gets before the other fields are cut too. */
const BODY_FLOOR = 80;
/** Every field at its floor: what is left before the oldest notes go. */
const FLOOR_CAPS: NoteCaps = { body: BODY_FLOOR, title: 40, tag: 24, tags: 3, event: 24 };

function asWeeklyNote(e: NotebookEntry, caps: NoteCaps): WeeklyNote | null {
  const body = cutTo(e.body.trim(), caps.body);
  if (!body) return null;
  const title = oneLine(e.title ?? "");
  const event = oneLine(e.event ?? "");
  const tool = oneLine(e.linkedTool ?? "");
  return {
    date: e.date,
    ...(title ? { title: cutTo(title, caps.title) } : {}),
    body,
    tags: normTags(e.tags ?? [])
      .filter((t) => t.length <= WEEKLY_TAG_MAX)
      .slice(0, caps.tags)
      .map((t) => cutTo(t, caps.tag)),
    ...(event ? { event: cutTo(event, caps.event) } : {}),
    ...(tool && tool.length <= WEEKLY_TOOL_MAX ? { linkedTool: tool } : {}),
  };
}

const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const bytesOf = (s: string) => (encoder ? encoder.encode(s).length : s.length * 3);

/** Whether a weekly read's input is inside both budgets. */
export function fitsWeeklyBudget(input: WeeklyInput): boolean {
  const json = JSON.stringify(input);
  return json.length <= WEEKLY_CHAR_BUDGET && bytesOf(json) <= WEEKLY_BYTE_BUDGET;
}

/**
 * The week's notes as Amr's weekly read takes them: kept summaries left
 * out, the newest WEEKLY_MAX_NOTES, oldest first, each note's text cut to
 * WEEKLY_BODY_MAX. While the whole is over a budget, every note's text is
 * cut shorter, down to BODY_FLOOR; then the titles, tags and events too;
 * then the oldest notes are left out, so what is sent always fits. Null when
 * the week has no note.
 */
export function weeklyInput(
  entries: readonly NotebookEntry[],
  weekStart: string
): WeeklyInput | null {
  let week = entries
    .filter((e) => inWeek(e.date, weekStart) && !isSummaryNote(e) && e.body.trim())
    .sort(compareNotes)
    .slice(0, WEEKLY_MAX_NOTES)
    .reverse();
  if (week.length === 0) return null;
  const build = (list: readonly NotebookEntry[], caps: NoteCaps): WeeklyInput => ({
    weekStart,
    notes: list.map((e) => asWeeklyNote(e, caps)).filter((n): n is WeeklyNote => n !== null),
  });
  for (let body = WEEKLY_BODY_MAX; ; body = Math.max(BODY_FLOOR, Math.floor(body * 0.75))) {
    const input = build(week, { ...FULL_CAPS, body });
    if (fitsWeeklyBudget(input)) return input;
    if (body <= BODY_FLOOR) break;
  }
  for (;;) {
    const input = build(week, FLOOR_CAPS);
    if (fitsWeeklyBudget(input) || week.length <= 1) return input;
    week = week.slice(1);
  }
}

/** "the Daily Scrum and the Retrospective", "the 1:1". */
function eventList(labels: readonly string[]): string {
  const named = labels.slice(0, 3).map((l) => (l === "Day to day" ? "day to day" : `the ${l}`));
  if (named.length <= 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** The themes that came up in two notes or more, most first. */
function repeatedThemes(notes: readonly WeeklyNote[]) {
  return themeCounts(notes).filter((t) => t.notes >= 2);
}

/**
 * The week read without AI: how many notes and where from, the themes that
 * came up more than once, and a tool for each of those themes (by registry
 * id; resolve them with resolveSuggestedTools before showing a link).
 */
export function weeklyFallback(input: WeeklyInput): WeeklyOutput {
  const notes = input.notes;
  const n = notes.length;
  const week = `the week of ${formatDay(input.weekStart)}`;
  if (n === 0) return { summary: `No notes in ${week} yet.`, patterns: [], tools: [] };

  const top = eventCounts(notes)[0];
  const repeated = repeatedThemes(notes);
  const themes = themeCounts(notes);

  const sentences: string[] = [];
  sentences.push(
    `${plural(n, "note")} in ${week}${
      top && top.count >= 2 ? `, ${top.count} of them from ${eventList([top.label])}` : ""
    }.`
  );
  if (repeated.length > 0) {
    const list = repeated
      .slice(0, 3)
      .map((t, i) => `${t.tag} (${i === 0 ? plural(t.notes, "note") : t.notes})`)
      .join(", ");
    sentences.push(`What came up most: ${list}.`);
  } else if (n > 1) {
    sentences.push("No theme came up in more than one note.");
  }
  const summary = cutTo(sentences.join(" "), WEEKLY_SUMMARY_MAX);

  const patterns: string[] = [];
  for (const t of repeated.slice(0, 4)) {
    const where = t.events.length > 0 ? `, at ${eventList(t.events)}` : "";
    patterns.push(
      cutTo(`“${t.tag}” came up in ${plural(t.notes, "note")}${where}.`, WEEKLY_PATTERN_MAX)
    );
  }
  if (top && n >= 4 && top.count >= 3 && top.count * 2 >= n) {
    patterns.push(
      cutTo(
        `${top.count} of ${n} notes came from ${eventList([top.label])}: notice the other events too.`,
        WEEKLY_PATTERN_MAX
      )
    );
  }

  // Tools for the repeated themes first; with fewer than two, the single ones too.
  const pool = repeated.length >= 2 ? repeated : themes;
  const tools: { id: string; why: string }[] = [];
  for (const t of pool) {
    if (tools.length >= 3) break;
    const theme = themeOf(t.tag);
    if (!theme?.tool || !theme.why || tools.some((x) => x.id === theme.tool)) continue;
    const count = t.notes >= 2 ? `“${t.tag}” came up in ${t.notes} notes` : `“${t.tag}” came up`;
    tools.push({ id: theme.tool, why: cutTo(`${count}: ${theme.why}.`, WEEKLY_WHY_MAX) });
  }

  return { summary, patterns: patterns.slice(0, WEEKLY_PATTERNS_MAX), tools };
}

/**
 * A kept summary's text: the summary, then the patterns kept, as a note's
 * body. Capped at the note's own limit by the caller.
 */
export function summaryNoteBody(summary: string, patterns: readonly string[]): string {
  const lines = [summary.trim()];
  const kept = patterns.map((p) => oneLine(p)).filter(Boolean);
  if (kept.length > 0) lines.push("", "Patterns:", ...kept.map((p) => `- ${p}`));
  return lines.join("\n");
}

/** A kept summary's title: "Week of 9 Nov 2026: summary". */
export const summaryNoteTitle = (weekStart: string) =>
  clip(`Week of ${formatDay(weekStart)}: summary`, 120);
