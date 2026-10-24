import type { StandupEntry } from "@/lib/stores/workspace-types";
import { notPostedYet } from "@/lib/standup/entries";
import { ageLabel, blockerAgeDays, openBlockers } from "./model";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "5 of 6 have posted", "Everyone has posted", "3 updates posted today". */
function postedPart(todays: readonly StandupEntry[], expected: readonly string[], today: string) {
  if (expected.length === 0) {
    if (todays.length === 0) return "no updates today yet";
    return `${todays.length} ${todays.length === 1 ? "update" : "updates"} posted today`;
  }
  const posted = expected.length - notPostedYet(todays, expected, today).length;
  if (posted === expected.length) return "everyone has posted";
  if (posted === 0) {
    return expected.length === 1
      ? "nobody has posted yet"
      : `none of the ${expected.length} have posted yet`;
  }
  return `${posted} of ${expected.length} ${posted === 1 ? "has" : "have"} posted`;
}

/** "no open blockers", "1 open blocker, 3 days old", "2 open blockers, the oldest 3 days". */
function blockerPart(entries: readonly StandupEntry[], today: string) {
  const open = openBlockers(entries);
  if (open.length === 0) return "no open blockers";
  const oldest = blockerAgeDays(open[0], today);
  if (open.length === 1) {
    return `1 open blocker, ${oldest === 0 ? "raised today" : `${ageLabel(oldest)} old`}`;
  }
  return oldest === 0
    ? `${open.length} open blockers, all raised today`
    : `${open.length} open blockers, the oldest ${ageLabel(oldest)}`;
}

/**
 * The one-sentence answer above the standup: who has posted today (of the
 * people expected: the team, minus anyone out today) and what is still
 * blocked, with the oldest blocker's age so a stuck one stands out.
 *
 *   "5 of 6 have posted; 2 open blockers, the oldest 3 days."
 */
export function standupVerdict({
  entries,
  expected,
  today,
}: {
  entries: readonly StandupEntry[];
  expected: readonly string[];
  today: string;
}): string {
  const todays = entries.filter((e) => e.date === today);
  return `${capitalise(postedPart(todays, expected, today))}; ${blockerPart(entries, today)}.`;
}
