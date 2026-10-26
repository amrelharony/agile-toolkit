import type { PsychSafetyLog } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { ROUND_NAME_MAX, defaultRoundName, roundDateProblem } from "@/lib/psych-safety/instrument";

/** What the facilitator fills in before a round: its name, day and sprint. */
export interface RoundDetails {
  name: string;
  date: string;
  sprintId?: string;
}

export interface RoundFields {
  name: string;
  date: string;
  sprintId?: string;
}

/**
 * A round's details as they are saved: the typed name, or the next
 * "Round N" (said under the field, so it is never a surprise); the day,
 * which can be backdated but not set in the future; and the sprint, if
 * one was picked.
 */
export function validateRoundDetails(
  d: RoundDetails,
  { today, log }: { today: string; log: PsychSafetyLog | null | undefined }
): Validation<RoundFields, "name" | "date"> {
  const name = d.name.trim();
  if (name.length > ROUND_NAME_MAX) {
    return { ok: false, errors: { name: `Keep it to ${ROUND_NAME_MAX} characters.` } };
  }
  const dateProblem = roundDateProblem(d.date, today);
  if (dateProblem) return { ok: false, errors: { date: dateProblem } };
  return {
    ok: true,
    values: {
      name: name || defaultRoundName(log),
      date: d.date,
      ...(d.sprintId ? { sprintId: d.sprintId } : {}),
    },
  };
}
