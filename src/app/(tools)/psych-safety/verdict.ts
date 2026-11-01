import type { PsychSafetyRound } from "@/lib/stores/workspace-types";
import { fmt, listAnd } from "@/lib/charts/chart-text";
import {
  ANOMALY_DROP,
  PSYCH_SAFETY_MIN_RESPONSES,
  PSYCH_SAFETY_QUESTIONS,
  compareRounds,
  coveredLabel,
  questionLabel,
  questionMeta,
  roundResult,
} from "@/lib/psych-safety/instrument";

const quote = (id: string | null | undefined) => {
  const q = id ? questionMeta(id) : undefined;
  return q ? `“${q.text}”` : "";
};

/**
 * The survey in one sentence, from the latest round and the one before it:
 *
 *   "Team score 3.7/5 from 7 responses, down 0.3 since Spring check-in;
 *    “If I make a mistake on this team, it is held against me.” fell most."
 */
export function psychSafetyVerdict(rounds: readonly PsychSafetyRound[]): string {
  const latest = rounds[rounds.length - 1];
  if (!latest) {
    return "No rounds yet: run one anonymously with the team, or enter the counts from paper.";
  }
  const result = roundResult(latest);
  if (!result || result.teamScore === null) {
    return `The latest round, ${latest.name}, has ${latest.responses} ${latest.responses === 1 ? "response" : "responses"}: results show from ${PSYCH_SAFETY_MIN_RESPONSES}, so no one's answers can be singled out.`;
  }
  const covers = coveredLabel(result);
  const head = `Team score ${fmt(result.teamScore)}/5${covers ? ` (${covers})` : ""} from ${result.responses} responses`;
  const previous = rounds[rounds.length - 2];
  const cmp = compareRounds(previous, latest);
  if (cmp && cmp.delta !== null && previous) {
    // The change is over the statements both rounds show: say so when that isn't all seven.
    const over =
      cmp.common.length < PSYCH_SAFETY_QUESTIONS.length
        ? ` (over the ${cmp.common.length} statements both show)`
        : "";
    const change =
      Math.abs(cmp.delta) < 0.05
        ? `level with ${previous.name}${over}`
        : `${cmp.delta < 0 ? "down" : "up"} ${fmt(Math.abs(cmp.delta))} since ${previous.name}${over}`;
    const fell = cmp.dropped[0]
      ? `; ${quote(cmp.dropped[0])} fell most`
      : result.lowest
        ? `; lowest: ${quote(result.lowest)}`
        : "";
    return `${head}, ${change}${fell}.`;
  }
  return result.lowest ? `${head}; lowest: ${quote(result.lowest)}.` : `${head}.`;
}

/**
 * The retro topic a fall between two rounds becomes: which statements
 * fell, and since when. Team level only: never who answered what.
 *
 *   "Psych safety: “It is safe to take a risk on this team.” fell by more
 *    than 0.5 since Spring check-in (October)"
 */
export function anomalyTopic(
  round: Pick<PsychSafetyRound, "name">,
  before: Pick<PsychSafetyRound, "name">,
  dropped: readonly string[]
): string {
  const what = dropped.length === 1 ? quote(dropped[0]) : listAnd(dropped.map(questionLabel));
  return `Psych safety: ${what} fell by more than ${ANOMALY_DROP} since ${before.name} (${round.name})`;
}
