/**
 * A sprint's ceremonies as one iCalendar file (RFC 5545), for the team's own
 * calendar apps. Pure: the caller supplies the moment, the site's address
 * and what to include, and saves the text (`exportToICS`, lib/utils/export).
 *
 * One VEVENT per ceremony from `ceremonyDates`, which has already skipped
 * the holidays, so there is no recurrence rule or exception date to get
 * wrong. No time zone is stored with the cadence: its times are the
 * browser's local times, written here as UTC instants. An entry lasts its
 * ceremony's timebox, or until the next ceremony starts when that is sooner.
 *
 * The file is a snapshot. Every entry has a UID that stays the same from one
 * download to the next (sprint id, ceremony and date), so a calendar that
 * honours UIDs replaces an entry instead of adding a second one.
 */

import type { Sprint } from "@/lib/stores/workspace-types";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import {
  CEREMONY_HREF,
  CEREMONY_LABEL,
  ceremonyDates,
  ceremonyTimeboxMinutes,
  timeboxLabel,
  type CeremonyCadence,
  type CeremonyOccurrence,
} from "./cadence";
import { isIsoDate, isoDayNumber, isoFromDayNumber, weekdayOf } from "./calendar";
import { hasSyntheticDates, sprintLengthDays } from "./series";

/** Minutes before a ceremony that its reminder shows. */
export const CEREMONY_REMINDER_MINUTES = 10;

/** The right-hand side of every UID. Fixed, so a preview host makes the same UIDs. */
const UID_DOMAIN = "agile.amrelharony.com";

const PRODID = "-//Agile Toolkit//Sprint ceremonies//EN";

/** A content line is at most this many octets, not counting its line break (RFC 5545 §3.1). */
export const MAX_LINE_OCTETS = 75;

/** A calendar title longer than this is cut; the whole text is in the description. */
const SUMMARY_MAX = 120;

/* ── Text ─────────────────────────────────────────────────────────────── */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const SPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/g;

/**
 * A TEXT value (RFC 5545 §3.3.11): backslash, semicolon and comma escaped,
 * a line break written as "\n", and other control characters dropped (a tab
 * becomes a space). Colons and quotes stay as they are.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Octets a piece of text takes in UTF-8 (a lone surrogate is saved as U+FFFD: three). */
function utf8Octets(text: string): number {
  let octets = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    octets += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return octets;
}

/**
 * One content line folded to 75 octets a line (RFC 5545 §3.1): each
 * continuation starts with a single space, which counts towards its 75. A
 * character is never cut in half, so the file stays valid UTF-8, and a
 * backslash stays on the line of the character it escapes (the standard
 * allows a fold there; a reader that unfolds late would not).
 */
export function foldIcsLine(line: string): string {
  const chars = Array.from(line);
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (let i = 0; i < chars.length; i++) {
    let unit = chars[i];
    if (unit === "\\" && i + 1 < chars.length) unit += chars[++i];
    const size = utf8Octets(unit);
    if (octets + size > MAX_LINE_OCTETS) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += unit;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** An instant as a UTC date-time, "YYYYMMDDTHHMMSSZ" (RFC 5545 §3.3.5, form 2). */
export function icsUtc(at: Date): string {
  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/** "YYYY-MM-DD" as a DATE value, "YYYYMMDD". */
function icsDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/** A local Date's own calendar day, "YYYYMMDD". */
function localDayStamp(at: Date): string {
  return `${pad(at.getFullYear(), 4)}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
}

/**
 * An id as part of a UID: letters, digits, dot and dash stay, anything else
 * becomes its code point between underscores ("," is "_2c_"), so the UID
 * needs no escaping and two ids never fold into one.
 */
function uidPart(id: string): string {
  return Array.from(id)
    .map((c) => (/[A-Za-z0-9.-]/.test(c) ? c : `_${(c.codePointAt(0) ?? 0).toString(16)}_`))
    .join("");
}

/** Text on one line, cut to `max` characters with "…" when it is longer. */
function oneLine(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  const head = chars.slice(0, max - 1).join("");
  return `${head.trimEnd()}…`;
}

/**
 * An address on the site (the live site when no origin is given). Whitespace
 * and control characters are dropped, so nothing can break out of its line.
 */
function siteUrl(origin: string, path: string): string {
  const base = origin.trim().replace(/\/+$/, "") || `https://${UID_DOMAIN}`;
  return `${base}${path}`.replace(SPACE_OR_CONTROL, "");
}

/** `path` opened on `sprintId`, as `sprintHref` (./use-selected-sprint) writes it. */
function sprintPath(path: string, sprintId: string): string {
  return `${path}?sprint=${encodeURIComponent(sprintId)}`;
}

/* ── Entries ──────────────────────────────────────────────────────────── */

/** One calendar entry, before it is written out. */
export interface CalendarEntry {
  uid: string;
  when:
    | { type: "timed"; start: Date; end: Date }
    /** A whole day, "YYYY-MM-DD", in whatever zone the calendar is in. */
    | { type: "day"; date: string };
  summary: string;
  description: string;
  url: string;
  /** Minutes before the start that a reminder shows. Absent: no reminder. */
  reminderMinutes?: number;
  /** What the reminder says. */
  reminderText?: string;
  /** Repeats every week on the day it starts. */
  weekly?: boolean;
  /** Shown without marking the time as busy. */
  free?: boolean;
}

/** What the calendar needs of a retro action (`RetroAction`, lib/retro/actions, fits). */
export interface CalendarAction {
  id: string;
  text: string;
  assignee?: string;
  dueDate?: string;
  done?: boolean;
  /** The retro it came from, for the description. */
  retroLabel?: string;
}

/**
 * The actions that can go on a calendar: still open, with a due date that
 * exists. One per card id, the first in the list (`collectRetroActions` puts
 * the current retro's first): an entry's UID is its card id, and two boards
 * can hold the same id (a retro share link imported twice keeps the ids), so
 * a second one would put two entries with one UID in the file.
 */
export function calendarActions<T extends CalendarAction>(actions: readonly T[]): T[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    if (a.done || typeof a.dueDate !== "string" || !isIsoDate(a.dueDate)) return false;
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

/**
 * The day the weekly story's entry starts, "YYYY-MM-DD": the first Sunday on
 * or after the sprint's first day. Null when the sprint has no start date.
 */
export function weeklyStoryStart(sprint: Pick<Sprint, "startDate">): string | null {
  const day = isoDayNumber(sprint.startDate);
  const weekday = weekdayOf(sprint.startDate);
  return day === null || weekday === null ? null : isoFromDayNumber(day + ((7 - weekday) % 7));
}

export interface SprintCalendarInput {
  sprint: Sprint;
  cadence: CeremonyCadence;
  /** When the file is made: every entry's DTSTAMP. */
  now: Date;
  /** The site's address ("https://agile.amrelharony.com"), for the links. */
  origin: string;
  /** Retro actions; the open ones with a due date become all-day entries. Absent: none. */
  actions?: readonly CalendarAction[];
  /** Add the weekly entry for the new Agile at Work story. */
  weeklyStory?: boolean;
}

/** The last line of an entry's description: where it came from and that it won't update itself. */
const snapshotNote = (change: string) =>
  `From the Agile Toolkit. This entry is a snapshot: if ${change}, download the calendar file again.`;

/**
 * The ceremony that starts while `occurrences[index]` would still be in its
 * timebox, if there is one. Its start is where that entry ends, so no two of
 * the sprint's ceremonies sit on a calendar at once: on the default times a
 * two-week sprint's 2 h review would run 30 minutes into the retro. One that
 * starts at the very same moment cuts nothing, since an entry needs a length.
 * `occurrences` is in time order.
 */
function cutShortBy(
  occurrences: readonly CeremonyOccurrence[],
  index: number,
  minutes: number
): CeremonyOccurrence | undefined {
  const start = occurrences[index].at.getTime();
  const next = occurrences.slice(index + 1).find((o) => o.at.getTime() > start);
  return next && next.at.getTime() < start + minutes * 60_000 ? next : undefined;
}

function ceremonyEntry(
  sprint: Sprint,
  { kind, at }: CeremonyOccurrence,
  /** Its timebox. */
  minutes: number,
  origin: string,
  /** The ceremony that starts before the timebox is up: the entry ends there. */
  cutBy?: CeremonyOccurrence
): CalendarEntry {
  const label = CEREMONY_LABEL[kind];
  const name = oneLine(sprint.name, SUMMARY_MAX) || "Sprint";
  const url = siteUrl(origin, sprintPath(CEREMONY_HREF[kind], sprint.id));
  const goal = sprint.goal?.trim();
  return {
    // The sprint's own date, not the UTC one: the same for a teammate in any zone.
    uid: `sprint-${uidPart(sprint.id)}-${kind}-${localDayStamp(at)}@${UID_DOMAIN}`,
    when: {
      type: "timed",
      start: at,
      end: cutBy ? cutBy.at : new Date(at.getTime() + minutes * 60_000),
    },
    summary: `${label} · ${name}`,
    description: [
      cutBy
        ? `Timebox: ${timeboxLabel(minutes)}. This entry ends when the ${CEREMONY_LABEL[cutBy.kind]} starts.`
        : `Timebox: ${timeboxLabel(minutes)}.`,
      ...(goal ? [`Sprint goal: ${goal}`] : []),
      `Open it on ${name}: ${url}`,
      "",
      snapshotNote("the ceremony times change"),
    ].join("\n"),
    url,
    reminderMinutes: CEREMONY_REMINDER_MINUTES,
    reminderText: `${label} starts in ${CEREMONY_REMINDER_MINUTES} minutes`,
  };
}

function actionEntry(action: CalendarAction, origin: string): CalendarEntry {
  const url = siteUrl(origin, "/retro-actions");
  const owner = action.assignee?.trim();
  const text = action.text.trim() || "Untitled action";
  return {
    // The card alone, not its date: a moved due date moves the entry.
    uid: `retro-action-${uidPart(action.id)}@${UID_DOMAIN}`,
    when: { type: "day", date: (action.dueDate ?? "").slice(0, 10) },
    summary: oneLine(`Retro action due: ${text}`, SUMMARY_MAX),
    description: [
      text,
      owner ? `Owner: ${owner}` : "No owner yet.",
      ...(action.retroLabel ? [`From: ${action.retroLabel}`] : []),
      `Mark it done in Retro Actions: ${url}`,
      "",
      snapshotNote("the action changes"),
    ].join("\n"),
    url,
    free: true,
  };
}

function storyEntry(date: string, origin: string): CalendarEntry {
  const url = siteUrl(origin, COMICS_ROUTE);
  return {
    // One UID for good: the entry repeats, and a later file must not add a second one.
    uid: `agile-at-work-weekly-story@${UID_DOMAIN}`,
    when: { type: "day", date },
    summary: "New Agile at Work story",
    description: ["A new Agile at Work story comes out every Sunday.", `Read it: ${url}`].join(
      "\n"
    ),
    url,
    weekly: true,
    free: true,
  };
}

/** What `sprintCalendarEntries` found to put in the file. */
export interface SprintCalendarEntries {
  entries: CalendarEntry[];
  ceremonies: number;
  actions: number;
  weeklyStory: boolean;
}

/**
 * Every entry of the sprint's calendar: its ceremonies in time order, then
 * the open retro actions by due date, then the weekly story. Empty when the
 * sprint has no real dates, whatever else was asked for.
 */
export function sprintCalendarEntries(input: SprintCalendarInput): SprintCalendarEntries {
  const { sprint, cadence, origin } = input;
  if (hasSyntheticDates(sprint)) {
    return { entries: [], ceremonies: 0, actions: 0, weeklyStory: false };
  }
  const length = sprintLengthDays(sprint);
  const occurrences = ceremonyDates(sprint, cadence);
  const entries = occurrences.map((o, i) => {
    const minutes = ceremonyTimeboxMinutes(o.kind, length);
    return ceremonyEntry(sprint, o, minutes, origin, cutShortBy(occurrences, i, minutes));
  });
  const ceremonies = entries.length;
  const due = calendarActions(input.actions ?? []).sort(
    (a, b) => (a.dueDate as string).localeCompare(b.dueDate as string) || a.id.localeCompare(b.id)
  );
  for (const action of due) entries.push(actionEntry(action, origin));
  const story = input.weeklyStory ? weeklyStoryStart(sprint) : null;
  if (story) entries.push(storyEntry(story, origin));
  return { entries, ceremonies, actions: due.length, weeklyStory: story !== null };
}

/* ── The file ─────────────────────────────────────────────────────────── */

function entryLines(entry: CalendarEntry, stamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${escapeIcsText(entry.uid)}`, `DTSTAMP:${stamp}`];
  if (entry.when.type === "timed") {
    lines.push(`DTSTART:${icsUtc(entry.when.start)}`, `DTEND:${icsUtc(entry.when.end)}`);
  } else {
    // An all-day entry ends on the morning of the next day (the end is exclusive).
    const day = isoDayNumber(entry.when.date) as number;
    lines.push(
      `DTSTART;VALUE=DATE:${icsDate(entry.when.date)}`,
      `DTEND;VALUE=DATE:${icsDate(isoFromDayNumber(day + 1))}`
    );
  }
  if (entry.weekly) lines.push("RRULE:FREQ=WEEKLY");
  lines.push(
    `SUMMARY:${escapeIcsText(entry.summary)}`,
    `DESCRIPTION:${escapeIcsText(entry.description)}`,
    `URL:${entry.url}`
  );
  if (entry.free) lines.push("TRANSP:TRANSPARENT");
  if (entry.reminderMinutes !== undefined) {
    const minutes = Math.max(0, Math.round(entry.reminderMinutes));
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(entry.reminderText ?? entry.summary)}`,
      `TRIGGER:-PT${minutes}M`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * The entries as one iCalendar object: CRLF line endings, lines folded at 75
 * octets, text escaped. No METHOD: the file carries a snapshot, not an
 * invitation (RFC 5545 §3.7.2), and DTSTAMP then says when it was made.
 */
export function icsFile(entries: readonly CalendarEntry[], now: Date): string {
  const stamp = icsUtc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    ...entries.flatMap((e) => entryLines(e, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export interface SprintCalendar {
  /** The iCalendar text. */
  ics: string;
  /** A name for the file, without ".ics". */
  filename: string;
  ceremonies: number;
  actions: number;
  weeklyStory: boolean;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sprint";

/** The sprint's calendar file, or null when the sprint has no real dates to place it on. */
export function sprintCalendar(input: SprintCalendarInput): SprintCalendar | null {
  const { entries, ...counts } = sprintCalendarEntries(input);
  if (entries.length === 0) return null;
  return {
    ics: icsFile(entries, input.now),
    filename: `${slug(input.sprint.name)}-ceremonies`,
    ...counts,
  };
}
