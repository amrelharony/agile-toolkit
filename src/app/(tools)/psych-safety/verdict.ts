import type { PsychSafetyRound } from "@/lib/stores/workspace-types";
import { fmt } from "@/lib/charts/chart-text";
import {
  PSYCH_SAFETY_MIN_RESPONSES,
  compareRounds,
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
  const head = `Team score ${fmt(result.teamScore)}/5 from ${result.responses} responses`;
  const previous = rounds[rounds.length - 2];
  const cmp = compareRounds(previous, latest);
  if (cmp && cmp.delta !== null && previous) {
    const change =
      Math.abs(cmp.delta) < 0.05
        ? `level with ${previous.name}`
        : `${cmp.delta < 0 ? "down" : "up"} ${fmt(Math.abs(cmp.delta))} since ${previous.name}`;
    const fell = cmp.dropped[0]
      ? `; ${quote(cmp.dropped[0])} fell most`
      : result.lowest
        ? `; lowest: ${quote(result.lowest)}`
        : "";
    return `${head}, ${change}${fell}.`;
  }
  return result.lowest ? `${head}; lowest: ${quote(result.lowest)}.` : `${head}.`;
}
