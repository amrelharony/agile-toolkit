/**
 * Who the team's kudos recognise: per person received, from how many
 * people, and when last, plus fairness hints read from the roster. Shared
 * by the Kudos page (chart, table, verdict, hints, Markdown) and
 * tool.kudos.recognition_stats, so the agent and the page count the same
 * kudos the same way.
 *
 * Pure and server-safe: no React, and only plain modules (the example-id
 * helpers, MIN_SAMPLE, the name matching in lib/team/names), so the agent
 * actions can call it on the server.
 */

import type { Kudos, Sprint, TeamMember } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { addDays } from "@/lib/flow/days";
import { dayOf } from "@/lib/impediments/model";
import { hasSyntheticDates, localDay } from "@/lib/sprints/series";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";

/** Local days, "YYYY-MM-DD", both included. */
export interface RecognitionWindow {
  from: string;
  to: string;
}

/** The page's window when no sprint has dates: the last 30 days, today included. */
export const RECENT_DAYS = 30;

/**
 * A top recipient with at least this share of the kudos reads as
 * concentrated (and at least twice a fair share, and ahead of everyone
 * else, so two people splitting the kudos evenly never do).
 */
export const CONCENTRATED_SHARE = 0.5;

/**
 * A kudos that recognises someone: not a reply in a kudos thread (a reply
 * copies its parent's recipient, so it would count as a second kudos for
 * them) and not example data. lib/retro/facts filters the same way.
 */
export function isRecognition(k: Pick<Kudos, "id" | "replyTo">): boolean {
  return !k.replyTo && !isExampleId(k.id);
}

/** Whether the kudos was sent on a local day inside `window` (any day without one). */
export function sentIn(k: Pick<Kudos, "sentAt">, window?: RecognitionWindow | null): boolean {
  if (!window) return true;
  const day = localDay(k.sentAt);
  return Boolean(day && day >= window.from && day <= window.to);
}

/**
 * A sprint's days, start to end, as the retro's facts read them; null for a
 * sprint without real dates (the "2020-01" placeholders).
 */
export function sprintWindow(
  sprint: Pick<Sprint, "startDate" | "endDate">
): RecognitionWindow | null {
  if (hasSyntheticDates(sprint)) return null;
  const from = dayOf(sprint.startDate);
  const to = dayOf(sprint.endDate);
  return from && to && from <= to ? { from, to } : null;
}

/** The last `days` days up to and including `today` ("YYYY-MM-DD"). */
export function lastDaysWindow(today: string, days: number = RECENT_DAYS): RecognitionWindow {
  const span = Math.max(1, Math.floor(days));
  return { from: addDays(today, -(span - 1)) ?? today, to: today };
}

/** One person's kudos received in the window. */
export interface RecipientTally {
  /** "member:<TeamMember.id>" for someone on the roster, else "name:<name key>". */
  key: string;
  /** The roster's spelling, else the latest kudos' spelling. */
  name: string;
  memberId?: string;
  onRoster: boolean;
  count: number;
  /** Different senders (by name key). */
  fromPeople: number;
  /** The latest kudos' sentAt. */
  lastAt: string | null;
}

export interface RecognitionSummary {
  /** Kudos counted: in the window, replies and examples left out. */
  total: number;
  /** Everyone who received one, most first (ties by name). */
  recipients: RecipientTally[];
  /** Roster members with none in the window, in roster order. */
  rosterWithNone: { memberId: string; name: string }[];
  /** The top recipient's share of the kudos (0–1); null with no kudos. */
  topShare: number | null;
  /** Enough kudos (MIN_SAMPLE.distribution) to read how recognition spreads. */
  enough: boolean;
}

export interface RecognitionOptions {
  /**
   * Count example kudos too. Only the page's example preview passes it, so
   * the example can show its chart; the agent and other tools never do.
   */
  includeExamples?: boolean;
}

const sentMs = (k: Pick<Kudos, "sentAt">) => {
  const t = Date.parse(k.sentAt);
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * Kudos received per person in `window` (all time without one). A kudos
 * counts for a roster member by `toMemberId` (so a rename keeps it), else
 * by the recipient's name matched to the roster (trimmed, case-insensitive);
 * a name off the roster gets its own row.
 */
export function recognitionReceived(
  kudos: readonly Kudos[],
  roster: readonly TeamMember[],
  window?: RecognitionWindow | null,
  opts: RecognitionOptions = {}
): RecognitionSummary {
  const byId = new Map(roster.map((m) => [m.id, m]));
  // Per recipient: the tally, plus what it is built from.
  const rows = new Map<string, { tally: RecipientTally; senders: Set<string>; lastMs: number }>();
  let total = 0;

  for (const k of kudos) {
    const counts = opts.includeExamples ? !k.replyTo : isRecognition(k);
    if (!counts || !sentIn(k, window)) continue;
    const member =
      (k.toMemberId ? byId.get(k.toMemberId) : undefined) ?? findRosterMember(roster, k.toName);
    const name = (k.toName ?? "").replace(/\s+/g, " ").trim();
    if (!member && !name) continue;
    const key = member ? `member:${member.id}` : `name:${nameKey(name)}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        tally: {
          key,
          name: member?.name ?? name,
          ...(member ? { memberId: member.id } : {}),
          onRoster: Boolean(member),
          count: 0,
          fromPeople: 0,
          lastAt: null,
        },
        senders: new Set(),
        lastMs: -Infinity,
      };
      rows.set(key, row);
    }
    total++;
    row.tally.count++;
    row.senders.add(nameKey(k.fromName) || k.fromProfileId || "");
    row.tally.fromPeople = row.senders.size;
    const ms = sentMs(k);
    if (row.tally.lastAt === null || ms > row.lastMs) {
      row.tally.lastAt = k.sentAt;
      row.lastMs = ms;
      // Off the roster, the latest spelling names the row.
      if (!member) row.tally.name = name;
    }
  }

  const recipients = Array.from(rows.values(), (r) => r.tally).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
  const reached = new Set(recipients.flatMap((r) => (r.memberId ? [r.memberId] : [])));
  const rosterWithNone = roster
    .filter((m) => !reached.has(m.id) && m.name.trim())
    .map((m) => ({ memberId: m.id, name: m.name.trim() }));

  return {
    total,
    recipients,
    rosterWithNone,
    topShare: total > 0 && recipients[0] ? recipients[0].count / total : null,
    enough: total >= MIN_SAMPLE.distribution,
  };
}

export interface FairnessHint {
  kind: "none-received" | "concentrated";
  /** The roster members the hint is about (none for an off-roster top recipient). */
  memberIds: string[];
  /** Their names, in the same order, for a "Send to …" button. */
  names: string[];
  sentence: string;
}

/** "Omar", "Omar and Lee", "Omar, Lee and Ana", "Omar, Lee, Ana and 2 more". */
export function listNames(names: readonly string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * Hints that recognition isn't reaching everyone: teammates with no kudos
 * in the window, and kudos piling up on one person. Nothing until there are
 * enough kudos to read (MIN_SAMPLE.distribution) and a roster of two or
 * more to compare. The sentences describe the kudos, never blame a person:
 * the one who got many did good work, and the ones with none may simply
 * have done quieter work.
 */
export function fairnessHints(
  summary: RecognitionSummary,
  rosterSize: number,
  { windowLabel = "in this window" }: { windowLabel?: string } = {}
): FairnessHint[] {
  if (!summary.enough || rosterSize < 2) return [];
  const hints: FairnessHint[] = [];

  const none = summary.rosterWithNone;
  if (none.length > 0) {
    const names = none.map((m) => m.name);
    const who = none.length > 3 ? `${none.length} teammates` : listNames(names);
    const has = none.length === 1 ? "hasn't" : "haven't";
    const tail = none.length > 3 ? `: ${listNames(names)}` : "";
    hints.push({
      kind: "none-received",
      memberIds: none.map((m) => m.memberId),
      names,
      sentence: `${who} ${has} received a kudos yet ${windowLabel}${tail}.`,
    });
  }

  const top = summary.recipients[0];
  const threshold = Math.max(CONCENTRATED_SHARE, 2 / rosterSize);
  // The top recipient must lead alone: a tie (5 and 5 of 10 with a roster
  // of four reaches the threshold) isn't kudos piling up on one person.
  const leadsAlone = top !== undefined && (summary.recipients[1]?.count ?? 0) < top.count;
  if (top && leadsAlone && summary.topShare !== null && summary.topShare >= threshold) {
    hints.push({
      kind: "concentrated",
      memberIds: top.memberId ? [top.memberId] : [],
      names: [top.name],
      sentence: `${top.name} received ${top.count} of ${summary.total} kudos ${windowLabel}. Recognition tends to follow the most visible work; quieter contributions may be worth a look too.`,
    });
  }
  return hints;
}
