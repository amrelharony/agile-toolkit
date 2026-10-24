import type { SixHatsHat, SixHatsSession, SixHatsThought } from "@/lib/stores/workspace-types";
import { enoughData } from "@/lib/analytics/min-sample";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { formatClock } from "@/lib/timer/dock-timer";
import { hatInfo } from "./hats";
import { byHat, currentIndex, hatColumns, roundLabel } from "./session";

/** What to do about a hat the discussion barely wore. Blue manages the rest, so it has none. */
const THIN_ADVICE: Partial<Record<SixHatsHat, string>> = {
  white: "check the facts",
  red: "ask how people feel about it",
  black: "look at the risks",
  yellow: "look for benefits",
  green: "look for alternatives",
};

/**
 * The balance of a discussion: where most thoughts went and which hat
 * is thin. Below a handful of thoughts "most under Black (1)" is noise,
 * so it only counts them (min-sample: a distribution).
 */
export function balanceSentence(
  topic: string | null,
  order: readonly SixHatsHat[] | null,
  thoughts: readonly SixHatsThought[]
): string {
  const lead = topic ? `“${topic}”: ` : "";
  const n = thoughts.length;
  if (n === 0) return topic ? `${lead}no thoughts yet.` : "No thoughts yet.";
  const counted = `${lead}${plural(n, "thought")}`;
  if (!enoughData(n, "distribution")) return `${counted} so far.`;

  const groups = byHat(thoughts);
  const hats = hatColumns(order, thoughts);
  const most = Math.max(...hats.map((h) => groups[h].length));
  const top = hats.filter((h) => groups[h].length === most);
  const names = listAnd(top.map((h) => hatInfo(h).name));
  const where =
    top.length === 1 ? `most under ${names} (${most})` : `most under ${names} (${most} each)`;

  // The thinnest hat the session meant to wear, if it barely came up.
  const candidates = hats.filter((h) => THIN_ADVICE[h] && !top.includes(h));
  const fewest = Math.min(...candidates.map((h) => groups[h].length));
  const thin = candidates.find((h) => groups[h].length === fewest && fewest <= 1);
  if (!thin) return `${counted}, ${where}.`;
  const has = fewest === 0 ? "has none" : "has only 1";
  return `${counted}, ${where}; ${hatInfo(thin).name} ${has}, so ${THIN_ADVICE[thin]} before deciding.`;
}

/**
 * The one-sentence answer above a session. During a round: where the
 * discussion is and the time left. Otherwise: the balance of what was
 * said, and whether the summary reached a decision record.
 */
export function sixHatsVerdict(
  session: SixHatsSession | null,
  thoughts: readonly SixHatsThought[],
  opts: { remainingSeconds?: number | null; sent?: boolean } = {}
): string {
  if (!session)
    return thoughts.length === 0 ? "No sessions yet." : balanceSentence(null, null, thoughts);
  const i = currentIndex(session);
  if (i !== null) {
    const left = opts.remainingSeconds;
    const round = roundLabel(session, i);
    if (left === undefined || left === null) return `${round}.`;
    return left <= 0 ? `${round}, time's up.` : `${round}, ${formatClock(left)} left.`;
  }
  if (thoughts.length === 0)
    return opts.sent ? "Summary sent to the Decision Log." : "No thoughts yet.";
  const balance = balanceSentence(session.topic, session.order, thoughts);
  return opts.sent ? `${balance} Summary sent to the Decision Log.` : balance;
}
