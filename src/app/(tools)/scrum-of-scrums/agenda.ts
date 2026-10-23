/**
 * The Scrum of Scrums agenda: entries grouped by meeting, and the open
 * blockers and dependencies that carry forward to the next one.
 *
 * Carrying forward is by reference, not by copy. An open blocker from last
 * week's meeting shows on this week's agenda as the same entry, so resolving
 * it in either meeting resolves it once, and its age keeps counting from
 * the day it was raised. Updates and decisions are records, not tasks: they
 * have no open or resolved state and never carry forward.
 *
 * Pure, so the page, the minutes export and the tests agree.
 */

import type { DependencyEdge, ISODateString, SosEntry } from "@/lib/stores/workspace-types";
import { edgeStatus } from "@/lib/dependencies/edges";
import { daysBetween, parseDay } from "../dependency-map/format";

export type EntryKind = SosEntry["kind"];

/** Agenda order: what's stuck first, then what was decided, then news. */
export const KIND_ORDER: readonly EntryKind[] = ["blocker", "dependency", "decision", "update"];

export const KIND_LABEL: Record<EntryKind, { one: string; many: string }> = {
  blocker: { one: "Blocker", many: "Blockers" },
  dependency: { one: "Dependency", many: "Dependencies" },
  decision: { one: "Decision", many: "Decisions" },
  update: { one: "Update", many: "Updates" },
};

/** Blockers and dependencies are tracked until resolved; the rest are records. */
export const isTracked = (kind: EntryKind) => kind === "blocker" || kind === "dependency";

/** A blocker this many days old (or older) is called out as stale. */
export const STALE_DAYS = 3;

export type TrackedStatus = "open" | "resolved";

/**
 * Where a blocker or dependency stands. A dependency on the Dependency Map
 * follows its edge, so a resolve on the map (or from PI Planning) shows
 * here; otherwise the entry's own status. Null for updates and decisions.
 */
export function statusOf(entry: SosEntry, edge?: DependencyEdge): TrackedStatus | null {
  if (!isTracked(entry.kind)) return null;
  if (entry.kind === "dependency" && edge) {
    return edgeStatus(edge) === "resolved" ? "resolved" : "open";
  }
  return entry.status === "resolved" ? "resolved" : "open";
}

const isDay = (d: string | undefined): d is string => Boolean(parseDay(d));

const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The meeting's day, YYYY-MM-DD, or "" when the entry has none. Read from
 * the start of `meetingDate`, as the old page and the MCP action do: an
 * entry saved with a timestamp there belongs to that day's meeting, and
 * used to vanish from every agenda while still counting as open.
 */
export function meetingDay(entry: Pick<SosEntry, "meetingDate">): string {
  const day = DAY_PREFIX.exec(entry.meetingDate ?? "")?.[1];
  return isDay(day) ? day : "";
}

/** Meetings that have entries, plus any just started, newest first. */
export function meetingDates(
  entries: readonly SosEntry[],
  started: readonly string[] = []
): string[] {
  const days = new Set<string>();
  for (const e of entries) {
    const day = meetingDay(e);
    if (day) days.add(day);
  }
  for (const d of started) if (isDay(d)) days.add(d);
  return Array.from(days).sort((a, b) => b.localeCompare(a));
}

/** Oldest first, then in the order logged, so editing never moves a row. */
const byRaised = (a: SosEntry, b: SosEntry) =>
  meetingDay(a).localeCompare(meetingDay(b)) || (a.loggedAt ?? "").localeCompare(b.loggedAt ?? "");

/** One meeting's own entries, grouped in agenda order. */
export function entriesOn(
  entries: readonly SosEntry[],
  date: ISODateString
): { kind: EntryKind; entries: SosEntry[] }[] {
  const own = entries.filter((e) => meetingDay(e) === date).sort(byRaised);
  return KIND_ORDER.map((kind) => ({ kind, entries: own.filter((e) => e.kind === kind) })).filter(
    (g) => g.entries.length > 0
  );
}

/**
 * Blockers and dependencies raised before `date` and still open: they stay
 * on the agenda. One with no readable meeting date belongs to no meeting,
 * so it carries into every one rather than staying open out of sight.
 */
export function carriedForward(
  entries: readonly SosEntry[],
  date: ISODateString,
  status: (e: SosEntry) => TrackedStatus | null
): SosEntry[] {
  return entries
    .filter((e) => {
      if (!isTracked(e.kind) || status(e) !== "open") return false;
      const day = meetingDay(e);
      return !day || day < date;
    })
    .sort(byRaised);
}

/** Whole days since the meeting it was raised at; null for a malformed date. */
export function ageDays(entry: SosEntry, today: ISODateString): number | null {
  const d = daysBetween(meetingDay(entry), today);
  return d === null ? null : Math.max(0, d);
}

/** Open blockers raised STALE_DAYS or more days ago. */
export function staleBlockers(
  entries: readonly SosEntry[],
  today: ISODateString,
  status: (e: SosEntry) => TrackedStatus | null
): SosEntry[] {
  return entries.filter((e) => {
    if (e.kind !== "blocker" || status(e) !== "open") return false;
    const age = ageDays(e, today);
    return age !== null && age >= STALE_DAYS;
  });
}
