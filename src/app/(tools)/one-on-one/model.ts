/**
 * The 1:1 tracker's data and its numbers: meetings with a rolling agenda,
 * how often each report has a 1:1 (the cadence), and the follow-ups still
 * open. Pure, so the page, the example, the Markdown export and the tests
 * share one definition of each number.
 *
 * The meetings stay a private blob under STORAGE_KEY (the notes are the
 * manager's, so no agent reads them); a report's cadence is a second blob
 * under CADENCE_KEY. `normalizeMeetings` reads every shape ever saved.
 */

import type { TeamMember } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import { percentile } from "@/lib/sprints/metrics";
import { findRosterMember, nameKey } from "@/lib/team/names";

export const STORAGE_KEY = "agile-toolkit:one-on-one";
/** Each report's cadence in days, by the report's name key. */
export const CADENCE_KEY = "agile-toolkit:one-on-one:cadence";

export type AgendaStatus = "open" | "discussed" | "action_required" | "done";

export const AGENDA_STATUSES: readonly AgendaStatus[] = [
  "open",
  "discussed",
  "action_required",
  "done",
];

export const STATUS_LABELS: Record<AgendaStatus, string> = {
  open: "Open",
  discussed: "Discussed",
  action_required: "Action",
  done: "Done",
};

export interface AgendaItem {
  id: string;
  text: string;
  status: AgendaStatus;
  action?: string;
  owner?: string;
  dueDate?: string;
  /** The day the follow-up was done ("YYYY-MM-DD"); set with Done, editable. */
  doneAt?: string;
  /**
   * Id of the item in an earlier 1:1 that this one was carried over from.
   * The earlier item is then superseded: the follow-up lives here, so it
   * isn't counted twice in "Action items overdue".
   */
  carriedFrom?: string;
}

export interface Meeting {
  id: string;
  manager: string;
  report: string;
  /** TeamMember.id when the name was on the roster when it was set. */
  managerMemberId?: string;
  reportMemberId?: string;
  /** "YYYY-MM-DD". */
  date: string;
  agenda: AgendaItem[];
  notes?: string;
  description?: string;
}

export type CadenceDays = 7 | 14 | 21 | 28;
export const CADENCE_OPTIONS: readonly CadenceDays[] = [7, 14, 21, 28];
/** Each report's cadence, by `nameKey(report)`. */
export type OneOnOneCadence = Record<string, CadenceDays>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A "YYYY-MM-DD" that exists ("2026-02-30" doesn't). */
export const isIsoDay = (v: unknown): v is string =>
  typeof v === "string" && ISO_DAY.test(v) && isIsoDate(v);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function normalizeItem(raw: unknown, i: number): AgendaItem | null {
  if (!isObject(raw)) return null;
  const status = AGENDA_STATUSES.includes(raw.status as AgendaStatus)
    ? (raw.status as AgendaStatus)
    : "open";
  // Spread first: a field a later version adds survives a write from this one.
  const item: AgendaItem = {
    ...(raw as Partial<AgendaItem>),
    id: str(raw.id) || `item-${i}`,
    text: str(raw.text) ?? "",
    status,
  };
  for (const k of ["action", "owner", "dueDate", "doneAt", "carriedFrom"] as const) {
    if (item[k] !== undefined && typeof item[k] !== "string") delete item[k];
  }
  return item;
}

/**
 * The meetings in any shape saved so far: the original array (statuses
 * open / discussed / action_required, free-text names, an optional or even
 * empty date) and this one (Done, member ids, done days). Rows that aren't
 * meetings are dropped; nothing else is changed, so it is safe to run on
 * every read and every write.
 */
export function normalizeMeetings(raw: unknown): Meeting[] {
  if (!Array.isArray(raw)) return [];
  const out: Meeting[] = [];
  raw.forEach((m, i) => {
    if (!isObject(m)) return;
    const agenda = Array.isArray(m.agenda)
      ? m.agenda.flatMap((a, j) => normalizeItem(a, j) ?? [])
      : [];
    const meeting: Meeting = {
      ...(m as Partial<Meeting>),
      id: str(m.id) || `meeting-${i}`,
      manager: str(m.manager) ?? "",
      report: str(m.report) ?? "",
      date: str(m.date) ?? "",
      agenda,
    };
    for (const k of ["managerMemberId", "reportMemberId", "notes", "description"] as const) {
      if (meeting[k] !== undefined && typeof meeting[k] !== "string") delete meeting[k];
    }
    out.push(meeting);
  });
  return out;
}

/** Only the cadences the picker offers; anything else reads as unset. */
export function normalizeCadence(raw: unknown): OneOnOneCadence {
  if (!isObject(raw)) return {};
  const out: OneOnOneCadence = {};
  for (const [k, v] of Object.entries(raw)) {
    if (CADENCE_OPTIONS.includes(v as CadenceDays)) out[k] = v as CadenceDays;
  }
  return out;
}

/** Manager and report, matched as people are everywhere: trimmed, case-insensitive. */
export function pairKey(m: Pick<Meeting, "manager" | "report">): string {
  return `${nameKey(m.manager)}::${nameKey(m.report)}`;
}

/**
 * The 1:1 a new one with the same pair follows: the latest on or before its
 * day that has an agenda (an empty placeholder never shadows a populated
 * one), else the latest at all. A back-dated 1:1 never inherits from a
 * later one.
 */
export function priorMeeting(
  meetings: readonly Meeting[],
  next: Pick<Meeting, "id" | "manager" | "report" | "date">
): Meeting | undefined {
  const pk = pairKey(next);
  const candidates = meetings
    .filter((m) => pairKey(m) === pk && m.id !== next.id && m.date <= next.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates.find((m) => m.agenda.length > 0) ?? candidates[0];
}

/**
 * What carries over from the prior 1:1: Open topics, and Actions with their
 * action, owner and due day, so the follow-up doesn't drop off. Discussed
 * and Done items stay where they were settled.
 */
export function carriedAgenda(prior: Meeting, newId: () => string): AgendaItem[] {
  return prior.agenda
    .filter((a) => a.status === "open" || a.status === "action_required")
    .map(
      (a): AgendaItem =>
        a.status === "open"
          ? { id: newId(), text: a.text, status: "open", carriedFrom: a.id }
          : {
              id: newId(),
              text: a.text,
              status: "action_required",
              ...(a.action !== undefined ? { action: a.action } : {}),
              ...(a.owner !== undefined ? { owner: a.owner } : {}),
              ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
              carriedFrom: a.id,
            }
    );
}

/** Calendar days from `from` to `to` ("YYYY-MM-DD"); null when either isn't a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = isoDayNumber(from);
  const b = isoDayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** Items a later 1:1 carried over: their follow-up lives in the copy. */
export function supersededIds(meetings: readonly Meeting[]): Set<string> {
  const out = new Set<string>();
  for (const m of meetings) for (const a of m.agenda) if (a.carriedFrom) out.add(a.carriedFrom);
  return out;
}

/** 1:1s dated in the month of `today`. */
export function meetingsThisMonth(meetings: readonly Meeting[], today: string): number {
  const month = today.slice(0, 7);
  return meetings.filter((m) => isIsoDay(m.date) && m.date.startsWith(month)).length;
}

/**
 * Actions past their due day and not done. A carried-over action counts
 * once, in the 1:1 it was carried to; a Done one never.
 */
export function overdueActions(meetings: readonly Meeting[], today: string): number {
  const superseded = supersededIds(meetings);
  let n = 0;
  for (const m of meetings) {
    for (const a of m.agenda) {
      if (a.status !== "action_required" || superseded.has(a.id)) continue;
      if (a.dueDate && isIsoDay(a.dueDate) && a.dueDate < today) n++;
    }
  }
  return n;
}

/**
 * Of the agenda items still standing (a carried-over original is counted in
 * its copy), the share discussed, given an action, or done; null with no
 * items. Each carried item used to stay "open" in the earlier 1:1 for good,
 * lowering the share for ever.
 */
export function addressedShare(meetings: readonly Meeting[]): number | null {
  const superseded = supersededIds(meetings);
  let total = 0;
  let addressed = 0;
  for (const m of meetings) {
    for (const a of m.agenda) {
      if (superseded.has(a.id)) continue;
      total++;
      if (a.status !== "open") addressed++;
    }
  }
  return total === 0 ? null : addressed / total;
}

/** One report's 1:1 rhythm. */
export interface ReportCadence {
  /** The report's name key (the roster's name when on it): the cadence's key too. */
  key: string;
  /**
   * Other name keys their 1:1s were saved under (before a rename on the
   * Team page); a cadence set under one still counts, and setting a new one
   * clears them.
   */
  aliases: string[];
  name: string;
  memberId?: string;
  /** 1:1s held (dated today or earlier). */
  meetings: number;
  /** Their days, oldest first. */
  dates: string[];
  lastDate: string | null;
  daysSince: number | null;
  /** Median days between 1:1s, from MIN_SAMPLE.average of them. */
  medianGapDays: number | null;
  /** The cadence to hold them to: the one set, else the usual gap. */
  targetDays: number | null;
  targetSource: "set" | "history" | null;
  /** Days past the cadence; null when not past it (or no cadence). */
  overdueBy: number | null;
  /** Actions still open with them (not done, not carried over). */
  openActions: number;
  /** The next 1:1 already dated after today. */
  nextDate: string | null;
}

/**
 * The roster member someone is: by the member id stamped on the 1:1, so a
 * rename on the Team page keeps the link, else by name.
 */
export function memberFor(
  roster: readonly TeamMember[],
  memberId: string | undefined,
  name: string
): TeamMember | undefined {
  const byId = memberId ? roster.find((m) => m.id === memberId) : undefined;
  return byId ?? findRosterMember(roster, name);
}

/**
 * Per report: when the last 1:1 was, how long ago, and whether that's past
 * their cadence. The cadence is the one set for them, else (from
 * MIN_SAMPLE.average gaps, so four 1:1s) their usual gap; with neither, only
 * the age shows and nothing alarms. A report on the roster is one row under
 * the roster's name, found by the member id on their 1:1s first (a rename
 * on the Team page doesn't split them in two). Roster members who have no
 * 1:1 yet get a row too, except the managers.
 */
export function cadenceByReport(
  meetings: readonly Meeting[],
  cadence: OneOnOneCadence,
  roster: readonly TeamMember[],
  today: string
): ReportCadence[] {
  const superseded = supersededIds(meetings);
  const groups = new Map<
    string,
    { name: string; memberId?: string; names: Set<string>; list: Meeting[] }
  >();
  const managers = new Set<string>();
  const managerIds = new Set<string>();
  const grouped = new Set<string>();
  for (const m of meetings) {
    const manager = memberFor(roster, m.managerMemberId, m.manager);
    if (manager) managerIds.add(manager.id);
    if (nameKey(m.manager)) managers.add(nameKey(m.manager));
    const member = memberFor(roster, m.reportMemberId, m.report);
    const key = nameKey(member?.name ?? m.report);
    if (!key) continue;
    const g = groups.get(key) ?? {
      name: member?.name.trim() ?? m.report.trim(),
      names: new Set<string>(),
      list: [],
    };
    if (member) g.memberId = member.id;
    else if (m.reportMemberId) g.memberId ??= m.reportMemberId;
    // The names they were saved under, for a cadence set before a rename.
    if (nameKey(m.report)) g.names.add(nameKey(m.report));
    if (g.memberId) grouped.add(g.memberId);
    g.list.push(m);
    groups.set(key, g);
  }
  for (const member of roster) {
    const key = nameKey(member.name);
    if (!key || groups.has(key) || grouped.has(member.id)) continue;
    if (managers.has(key) || managerIds.has(member.id)) continue;
    groups.set(key, { name: member.name.trim(), memberId: member.id, names: new Set(), list: [] });
  }

  const rows: ReportCadence[] = [];
  groups.forEach((g, key) => {
    const held = Array.from(
      new Set(g.list.map((m) => m.date).filter((d) => isIsoDay(d) && d <= today))
    ).sort();
    const upcoming = g.list
      .map((m) => m.date)
      .filter((d) => isIsoDay(d) && d > today)
      .sort();
    const lastDate = held[held.length - 1] ?? null;
    const daysSince = lastDate ? daysBetween(lastDate, today) : null;
    const gaps: number[] = [];
    for (let i = 1; i < held.length; i++) gaps.push(daysBetween(held[i - 1], held[i]) ?? 0);
    // The sample is the gaps, not the 1:1s: two gaps (1:1s on day 0, 7 and
    // 28) read as a usual gap of 7, so the report was overdue eight days
    // after their last 1:1 though they meet about every two weeks.
    const medianGapDays = gaps.length >= MIN_SAMPLE.average ? percentile(gaps, 50) : null;
    // Set under their name now, else under a name their 1:1s were saved as.
    const set = cadence[key] ?? cadenceUnder(cadence, g.names);
    const targetDays = set ?? medianGapDays;
    const targetSource = set ? "set" : medianGapDays !== null ? "history" : null;
    const overdueBy =
      targetDays !== null && daysSince !== null && daysSince > targetDays
        ? daysSince - targetDays
        : null;
    let openActions = 0;
    for (const m of g.list) {
      for (const a of m.agenda) {
        if (a.status === "action_required" && !superseded.has(a.id)) openActions++;
      }
    }
    rows.push({
      key,
      aliases: Array.from(g.names).filter((k) => k !== key),
      name: g.name,
      ...(g.memberId ? { memberId: g.memberId } : {}),
      meetings: held.length,
      dates: held,
      lastDate,
      daysSince,
      medianGapDays,
      targetDays,
      targetSource,
      overdueBy,
      openActions,
      nextDate: upcoming[0] ?? null,
    });
  });
  return rows;
}

/** The first cadence set under any of `keys`. */
function cadenceUnder(
  cadence: OneOnOneCadence,
  keys: ReadonlySet<string>
): CadenceDays | undefined {
  return Array.from(keys)
    .map((k) => cadence[k])
    .find((d) => d !== undefined);
}

/** Most overdue first, then the longest since a 1:1, then those with none yet. */
export function compareCadence(a: ReportCadence, b: ReportCadence): number {
  const over = (b.overdueBy ?? -1) - (a.overdueBy ?? -1);
  if (over !== 0) return over;
  const since = (b.daysSince ?? -1) - (a.daysSince ?? -1);
  if (since !== 0) return since;
  return a.name.localeCompare(b.name);
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** "last 1:1 18 days ago", "last 1:1 today", "no 1:1 yet". */
export function lastText(r: Pick<ReportCadence, "daysSince">): string {
  if (r.daysSince === null) return "no 1:1 yet";
  if (r.daysSince === 0) return "last 1:1 today";
  return `last 1:1 ${days(r.daysSince)} ago`;
}

/** "every 14 days", "about every 12 days (their usual gap)", or "". */
export function targetText(r: Pick<ReportCadence, "targetDays" | "targetSource">): string {
  if (r.targetDays === null) return "";
  return r.targetSource === "set"
    ? `every ${days(r.targetDays)}`
    : `about every ${days(r.targetDays)} (their usual gap)`;
}

/** "Raj · last 1:1 18 days ago · every 14 days → 4 days overdue". */
export function cadenceLine(r: ReportCadence): string {
  const parts = [r.name, lastText(r)];
  const target = targetText(r);
  if (target)
    parts.push(r.overdueBy !== null ? `${target} → ${days(r.overdueBy)} overdue` : target);
  return parts.join(" · ");
}

/**
 * The one sentence above the 1:1s: who is past their cadence, else how the
 * reports stand.
 */
export function cadenceVerdict(rows: readonly ReportCadence[]): string {
  const held = rows.filter((r) => r.meetings > 0);
  if (held.length === 0) return "No 1:1s yet.";
  const reports = rows.length === 1 ? "1 report" : `${rows.length} reports`;
  const over = rows.filter((r) => r.overdueBy !== null).sort(compareCadence);
  const none = rows.filter((r) => r.meetings === 0);
  const noneText =
    none.length === 0
      ? ""
      : none.length <= 2
        ? `; no 1:1 yet with ${none.map((r) => r.name).join(" and ")}`
        : `; no 1:1 yet with ${none.length} people`;
  if (over.length > 0) {
    const list = over
      .slice(0, 3)
      .map((r) => `${r.name} (${days(r.daysSince ?? 0)})`)
      .join(", ");
    const more = over.length > 3 ? ` and ${over.length - 3} more` : "";
    const are = over.length === 1 ? "is" : "are";
    return `${over.length} of ${reports} ${are} past their cadence: ${list}${more}${noneText}.`;
  }
  const longest = [...held].sort(compareCadence)[0];
  const withTarget = held.filter((r) => r.targetDays !== null).length;
  const within =
    withTarget === 0
      ? "set a cadence to be told when a 1:1 is late"
      : withTarget === held.length
        ? "all within their cadence"
        : `${withTarget} with a cadence, all within it`;
  return `${reports}, ${within}; the longest since a 1:1 is ${longest.name} (${days(longest.daysSince ?? 0)})${noneText}.`;
}
