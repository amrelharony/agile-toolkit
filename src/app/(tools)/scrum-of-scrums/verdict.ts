import type { ISODateString, SosEntry } from "@/lib/stores/workspace-types";
import { listAnd } from "@/lib/charts/chart-text";
import { STALE_DAYS, ageDays, carriedForward, type TrackedStatus } from "./agenda";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-sentence state of a meeting's agenda: what's still open (its own
 * entries plus what carried forward), how much of it is stale, and what
 * the meeting recorded.
 *
 *   "2 open blockers (1 raised 3 or more days ago) and 2 open dependencies
 *    on the agenda; 1 decision recorded."
 */
export function meetingVerdict(
  entries: readonly SosEntry[],
  date: ISODateString,
  today: ISODateString,
  status: (e: SosEntry) => TrackedStatus | null
): string {
  const own = entries.filter((e) => e.meetingDate === date);
  const agenda = [...carriedForward(entries, date, status), ...own];
  if (agenda.length === 0) return "Nothing logged for this meeting yet.";

  const open = agenda.filter((e) => status(e) === "open");
  const blockers = open.filter((e) => e.kind === "blocker");
  const deps = open.filter((e) => e.kind === "dependency");
  const stale = blockers.filter((e) => (ageDays(e, today) ?? 0) >= STALE_DAYS).length;

  const tracked: string[] = [];
  if (blockers.length > 0) {
    tracked.push(
      `${count(blockers.length, "open blocker", "open blockers")}${
        stale > 0 ? ` (${stale} raised ${STALE_DAYS} or more days ago)` : ""
      }`
    );
  }
  if (deps.length > 0) tracked.push(count(deps.length, "open dependency", "open dependencies"));

  const decisions = own.filter((e) => e.kind === "decision").length;
  const updates = own.filter((e) => e.kind === "update").length;
  const records = [
    ...(decisions > 0 ? [count(decisions, "decision", "decisions")] : []),
    ...(updates > 0 ? [count(updates, "update", "updates")] : []),
  ];
  const recorded = records.length > 0 ? `${listAnd(records)} recorded` : "";

  if (tracked.length === 0) {
    return `No open blockers or dependencies${recorded ? `; ${recorded}` : ""}.`;
  }
  return `${listAnd(tracked)} on the agenda${recorded ? `; ${recorded}` : ""}.`;
}
