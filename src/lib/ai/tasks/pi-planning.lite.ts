/**
 * PI Planning's AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `pi-planning.ts` and loads on first AI use): the caps,
 * the ask the page builds from the board (short ids, mapped back), the
 * byte fit, the keyword fallback, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { cutText } from "@/lib/utils/cut-text";
import type { PiItem, PiState } from "@/lib/pi-planning/model";
import { guessRoam } from "@/lib/pi-planning/roam";
import type { RoamInput, RoamOutput } from "./pi-planning";
export type { RoamInput, RoamOutput } from "./pi-planning";

export const ROAM_TASK_ID = "pi-planning.roam";
export const ROAM_RISKS_MAX = 40;
export const ROAM_ID_MAX = 8;
export const ROAM_TITLE_MAX = 200;
export const ROAM_TEAM_MAX = 80;
export const ROAM_NOTE_MAX = 500;
export const ROAM_REASON_MAX = 120;
export const ROAM_ACTION_MAX = 160;
/** The statuses Amr may suggest: only the room calls a risk resolved. */
export const ROAM_SUGGESTED = ["owned", "accepted", "mitigated"] as const;

/** The short id the ask gives the risk at `index`: r1 to r40. */
export const roamAskId = (index: number) => `r${index + 1}`;

/**
 * ROAM without AI: the keyword rules (`guessRoam`, lib/pi-planning/roam)
 * for every risk. A risk with no id or title (input the schema refuses) is
 * left out, never answered with an output the schema would refuse.
 */
export function roamFallback({ risks }: RoamInput): RoamOutput {
  return {
    risks: risks
      .filter((r) => r.id.trim() && r.id.length <= ROAM_ID_MAX && r.title.trim())
      .slice(0, ROAM_RISKS_MAX)
      .map((r) => ({ id: r.id, ...guessRoam(r.title, r.note) })),
  };
}

export const roamTask = lazyAiTask<RoamInput, RoamOutput>(
  { id: ROAM_TASK_ID, toolId: "pi-planning", fallback: roamFallback },
  () => import("./pi-planning").then((m) => m.roamTask)
);

/** One line of text, cut to `max` without splitting a character. */
const line = (text: string, max: number) => cutText(text.replace(/\s+/g, " ").trim(), max).trim();

/**
 * What the page asks about: the risks still to sort (at most 40, board
 * order), each with a short id, its title, its team and its note (or its
 * description), and the board item behind each short id.
 */
export function roamAskFor(
  state: PiState,
  risks: readonly PiItem[]
): { input: RoamInput; itemIds: string[] } {
  const asked = risks.filter((r) => r.title.trim()).slice(0, ROAM_RISKS_MAX);
  const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? "";
  return {
    itemIds: asked.map((r) => r.id),
    input: {
      risks: asked.map((r, i) => {
        const note = line(r.roamNote ?? r.description ?? "", ROAM_NOTE_MAX);
        return {
          id: roamAskId(i),
          title: line(r.title, ROAM_TITLE_MAX),
          team: line(team(r.teamId), ROAM_TEAM_MAX),
          ...(note ? { note } : {}),
        };
      }),
    },
  };
}

/** The board item a short id names, or undefined for an id the ask never gave. */
export function roamItemId(itemIds: readonly string[], askId: string): string | undefined {
  const m = /^r([1-9]\d?)$/.exec(askId.trim());
  return m ? itemIds[Number(m[1]) - 1] : undefined;
}

/**
 * The ask, trimmed until its request (`{task, input}`) fits `budget`
 * bytes: notes go first, from the last risk up, then whole risks from the
 * end. The input as it is when it already fits. Forty long risks in a
 * script of three bytes a character can pass the visitor route's cap.
 */
export function fitRoamInput(input: RoamInput, budget = TOOL_AI_BODY_BUDGET): RoamInput {
  const size = (risks: RoamInput["risks"]) =>
    jsonBytes({ task: ROAM_TASK_ID, input: { ...input, risks } });
  let risks = input.risks;
  if (size(risks) <= budget) return input;
  risks = risks.map((r) => ({ ...r }));
  for (let i = risks.length - 1; i >= 0 && size(risks) > budget; i--) delete risks[i].note;
  while (risks.length > 1 && size(risks) > budget) risks = risks.slice(0, -1);
  return { ...input, risks };
}
