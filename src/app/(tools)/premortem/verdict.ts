import { isExampleId } from "@/components/tool-frame/example-data";
import { listAnd, plural } from "@/lib/charts/chart-text";
import {
  TOP_N,
  causeScore,
  isRated,
  scoreText,
  topCauses,
  totalVotes,
  votesOf,
  type Premortem,
  type PremortemCause,
} from "./model";

/**
 * Why the example's causes don't go to the Risk Register: they would land
 * there as real risks with real ids, which neither Clear example removes.
 */
export const EXAMPLE_CAUSES_STAY =
  "Example causes stay in the example: start a premortem of your own to send risks.";

/** A cause in a sentence: quoted, and short enough to read aloud. */
export function quoteCause(c: Pick<PremortemCause, "text">, max = 60): string {
  const t = c.text.trim() || "(untitled)";
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
}

/** "the top 3", or "the top cause" when there is only one. */
export const topLabel = (n: number): string => (n === 1 ? "the top cause" : `the top ${n}`);

const votesText = (c: PremortemCause) => plural(votesOf(c), "vote");

/** "5 votes, L4 × I4 = 16", leaving out what isn't there yet. */
function standing(c: PremortemCause): string {
  const parts = [
    ...(votesOf(c) > 0 ? [votesText(c)] : []),
    ...(causeScore(c) !== null ? [scoreText(c)] : []),
  ];
  return parts.join(", ");
}

/**
 * The one-sentence answer for the phase the premortem is in: how far the
 * room has got, and what to do next. In the Act phase it names the top
 * risk and what is still missing before the top causes are safe to hand
 * to the Risk Register.
 *
 * `isSent` says whether a cause is in the Risk Register (the page checks
 * that the risk still exists); without it, nothing counts as sent.
 */
export function premortemVerdict(
  p: Premortem,
  isSent: (c: PremortemCause) => boolean = () => false
): string {
  const { causes } = p;
  if (causes.length === 0) return "No causes yet: imagine it failed and write why.";
  const n = causes.length;

  if (p.phase === "write") {
    return `${plural(n, "cause")} written so far. When the writing time is up, move on to Group.`;
  }

  if (p.phase === "group") {
    const grouped = causes.reduce((sum, c) => sum + (c.merged?.length ?? 0), 0);
    return grouped > 0
      ? `${plural(n, "distinct cause")} after grouping ${plural(grouped, "duplicate")}. Vote once every duplicate is grouped.`
      : `${plural(n, "cause")}, none grouped yet. Put duplicates together, then vote.`;
  }

  const { top, tied } = topCauses(causes);
  const tie =
    tied.length > 0
      ? `${listAnd(tied.map((c) => quoteCause(c, 40)))} tie at the cut-off${votesOf(tied[0]) > 0 ? ` with ${votesText(tied[0])}` : ""}, so break the tie before you act.`
      : "";

  if (p.phase === "vote") {
    if (totalVotes(causes) === 0) {
      return p.dotsPerPerson
        ? `No votes yet: give everyone ${plural(p.dotsPerPerson, "dot")} for the causes most likely to sink it.`
        : "No votes yet: give everyone a few dots for the causes most likely to sink it.";
    }
    const lead = `${quoteCause(top[0])} leads with ${votesText(top[0])}.`;
    const next =
      top.length === 1
        ? "The top cause goes to the Risk Register."
        : `The top ${top.length} go to the Risk Register.`;
    return `${lead} ${tie || next}`;
  }

  // Act.
  if (top.length === 0) {
    return `Nothing separates the causes yet: vote, or rate likelihood and impact, to find ${topLabel(TOP_N)}.`;
  }
  const unrated = top.filter((c) => !isRated(c)).length;
  if (unrated > 0) {
    const which =
      unrated === top.length ? topLabel(top.length) : `${unrated} of ${topLabel(top.length)}`;
    return `Rate likelihood and impact for ${which} before ${unrated === 1 ? "it goes" : "they go"} to the Risk Register.`;
  }
  const lead = `Top risk: ${quoteCause(top[0])} (${standing(top[0])}).`;
  if (tie) return `${lead} ${tie}`;
  // A risk needs a title: the old Add Cause saved some causes blank.
  const blank = top.filter((c) => !c.text.trim() && !isSent(c)).length;
  if (blank > 0) {
    return `${lead} Write the ${blank === 1 ? "cause that has" : `${blank} causes that have`} no text yet before ${blank === 1 ? "it goes" : "they go"} to the Risk Register.`;
  }
  const noAction = top.filter((c) => !c.preventiveAction?.trim()).length;
  if (noAction > 0) {
    const which =
      noAction === top.length
        ? top.length === 1
          ? "It has"
          : `None of the top ${top.length} has`
        : `${noAction} of the top ${top.length} ${noAction === 1 ? "has" : "have"}`;
    return `${lead} ${which} no preventive action yet.`;
  }
  const sent = top.filter(isSent).length;
  if (sent === top.length) {
    return `${lead} ${top.length === 1 ? "It is" : `All ${top.length} are`} in the Risk Register.`;
  }
  // Example causes never become real risks (Send skips them).
  if (top.every((c) => isSent(c) || isExampleId(c.id))) {
    return `${lead} Each has a preventive action. ${EXAMPLE_CAUSES_STAY}`;
  }
  return `${lead} Each has a preventive action: send ${top.length === 1 ? "it" : "them"} to the Risk Register.`;
}
