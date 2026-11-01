import { exampleId } from "@/components/tool-frame/example-data";
import type {
  PsychSafetyCounts,
  PsychSafetyLog,
  PsychSafetyQuestionId,
  PsychSafetyRound,
} from "@/lib/stores/workspace-types";
import { PSYCH_SAFETY_ID } from "@/lib/psych-safety/instrument";
import { todayLocalISO } from "@/lib/utils/formatters";

type Counts = Record<PsychSafetyQuestionId, PsychSafetyCounts>;

/**
 * Six people in the first round, seven a month later (counts of 1–5 per
 * statement, raw). Most statements hold steady, but after a release that
 * went wrong and a tense review, "if I make a mistake, it is held against
 * me" jumps: its score (reverse-scored) falls by more than a point, which
 * is the drop the comparison flags.
 */
const SPRING: Counts = {
  q1: [2, 3, 1, 0, 0],
  q2: [0, 0, 1, 3, 2],
  q3: [3, 2, 1, 0, 0],
  q4: [0, 1, 2, 2, 1],
  q5: [2, 3, 1, 0, 0],
  q6: [0, 0, 1, 4, 1],
  q7: [0, 1, 1, 3, 1],
};

const AFTER_INCIDENT: Counts = {
  q1: [0, 2, 2, 3, 0],
  q2: [0, 0, 2, 3, 2],
  q3: [3, 3, 1, 0, 0],
  q4: [0, 2, 2, 2, 1],
  q5: [2, 3, 2, 0, 0],
  q6: [0, 0, 2, 4, 1],
  q7: [0, 1, 2, 3, 1],
};

/**
 * Two rounds of a product team, the second after an incident. The whole
 * log is the example (its rounds' ids are `exampleId`s): the page shows it
 * as a read-only preview and never writes it into the workspace.
 */
export function buildExample(now: Date = new Date()): PsychSafetyLog {
  const weeksAgo = (n: number) =>
    todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n * 7));
  const round = (
    key: string,
    name: string,
    weeks: number,
    counts: Counts,
    responses: number
  ): PsychSafetyRound => ({
    id: exampleId(key),
    name,
    date: weeksAgo(weeks),
    source: "room",
    responses,
    counts,
    createdAt: `${weeksAgo(weeks)}T10:00:00.000Z`,
  });
  return {
    id: PSYCH_SAFETY_ID,
    responses: [],
    rounds: [
      round("round-1", "Spring check-in", 6, SPRING, 6),
      round("round-2", "After the incident", 2, AFTER_INCIDENT, 7),
    ],
  };
}
