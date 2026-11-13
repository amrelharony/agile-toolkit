import { exampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { PickerList, PickerRecent, PickerRoleTurn } from "@/lib/picker/model";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A squad of seven that rotates who runs its ceremonies. Amina facilitated
 * three weeks ago, Ben two weeks ago and Chloé last week, so Dev, Elif,
 * Farah and Gus are due; Dev and Elif have taken notes, Farah kept time.
 * Gus asked for more turns, so he weighs double on the wheel. Ben was spun
 * an hour ago and a 2d6 roll settled an estimate tie. The squad is a saved
 * list, so loading the example puts it on the wheel and gives it the roles.
 *
 * Every row carries an `example-` id, so Clear example removes exactly
 * them; the team's own lists and history stay.
 */
export const EXAMPLE_LIST_ID = exampleId("list-aurora");

const PEOPLE: [name: string, weight: number][] = [
  ["Amina", 1],
  ["Ben", 1],
  ["Chloé", 1],
  ["Dev", 1],
  ["Elif", 1],
  ["Farah", 1],
  ["Gus", 2],
];

const TURNS: [key: string, roleId: string, person: string, daysAgo: number][] = [
  ["turn-1", "role-facilitator", "Amina", 21],
  ["turn-2", "role-facilitator", "Ben", 14],
  ["turn-3", "role-facilitator", "Chloé", 7],
  ["turn-4", "role-scribe", "Dev", 14],
  ["turn-5", "role-scribe", "Elif", 7],
  ["turn-6", "role-timekeeper", "Farah", 7],
];

export interface PickerExample {
  list: PickerList;
  roleTurns: PickerRoleTurn[];
  recent: PickerRecent[];
}

export function buildExample(now: Date = new Date()): PickerExample {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  return {
    list: {
      id: EXAMPLE_LIST_ID,
      name: "Aurora squad",
      entries: PEOPLE.map(([name, weight]) => ({ name, weight })),
      updatedAt: at(DAY_MS),
    },
    roleTurns: TURNS.map(([key, roleId, person, days]) => ({
      id: exampleId(key),
      roleId,
      person,
      at: at(days * DAY_MS),
      day: todayLocalISO(new Date(now.getTime() - days * DAY_MS)),
    })),
    recent: [
      {
        id: exampleId("pick-1"),
        kind: "wheel",
        result: "Ben",
        detail: "Aurora squad (7 names)",
        at: at(HOUR_MS),
      },
      {
        id: exampleId("pick-2"),
        kind: "dice",
        result: "4 + 2 = 6",
        detail: "2d6",
        at: at(2 * HOUR_MS),
      },
    ],
  };
}
