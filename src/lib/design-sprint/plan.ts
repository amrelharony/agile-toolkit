/**
 * The five days of a design sprint and the tasks each one starts with.
 *
 * Shared by the Design Sprint page and its agent actions, so a sprint an
 * agent starts gets the same day names and checklist as one started on the
 * page (the agent's start_sprint used to create five empty days while the
 * page seeded these tasks). Which day it is today lives in ./day.ts.
 */

import type {
  DesignSprintDay,
  DesignSprintDayNumber,
  DesignSprintPlan,
} from "@/lib/stores/workspace-types";

export type DesignSprintDayName = DesignSprintDay["dayName"];

/** Day 1 to day 5, in order. */
export const DESIGN_SPRINT_DAY_NUMBERS: readonly DesignSprintDayNumber[] = [1, 2, 3, 4, 5];

export const DESIGN_SPRINT_DAY_NAMES: Readonly<Record<DesignSprintDayNumber, DesignSprintDayName>> =
  {
    1: "Map",
    2: "Sketch",
    3: "Decide",
    4: "Prototype",
    5: "Test",
  };

/** What each day is for, in one line (under the day's heading and in the export). */
export const DESIGN_SPRINT_DAY_PURPOSE: Readonly<Record<DesignSprintDayNumber, string>> = {
  1: "Agree the long-term goal, map the problem and pick a target.",
  2: "Gather ideas, then everyone sketches a solution on their own.",
  3: "Critique the sketches; the Decider picks one and the team storyboards it.",
  4: "Build a realistic prototype of the storyboard.",
  5: "Test the prototype with five customers and look for patterns.",
};

/** The checklist each day starts with (the Google Ventures book's agenda). */
export const DEFAULT_DESIGN_SPRINT_TASKS: Readonly<
  Record<DesignSprintDayNumber, readonly string[]>
> = {
  1: [
    "Set the long-term goal",
    "List sprint questions",
    "Map the problem (user journey)",
    "Lightning talks from experts",
    "Capture How Might We notes",
    "Pick a target on the map",
  ],
  2: [
    "Lightning Demos for inspiration",
    "Individual sketching warm-up (notes, ideas, crazy 8s)",
    "Solution sketches (3-panel)",
    "Recruit users for Friday's test",
  ],
  3: [
    "Art museum: post all sketches on the wall",
    "Heat map: silent dot voting",
    "Speed critique of top sketches",
    "Straw poll then Decider's supervote",
    "Storyboard the chosen solution",
  ],
  4: [
    "Pick the right tools for prototype fidelity",
    "Divide and conquer (Maker, Stitcher, Writer, Asset Collector, Interviewer)",
    "Build the prototype",
    "Trial run with one teammate before close of day",
  ],
  5: [
    "Run 5 user interviews (1 hour each)",
    "Take notes in the Test Room",
    "Look for patterns across all 5 interviews",
    "Decide what to do next based on findings",
  ],
};

export function isDesignSprintDayNumber(n: unknown): n is DesignSprintDayNumber {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5;
}

const randomId = () => crypto.randomUUID();

/** The five days with their default tasks, nothing done and no outputs yet. */
export function buildDesignSprintDays(newId: () => string = randomId): DesignSprintDay[] {
  return DESIGN_SPRINT_DAY_NUMBERS.map((day) => ({
    day,
    dayName: DESIGN_SPRINT_DAY_NAMES[day],
    tasks: DEFAULT_DESIGN_SPRINT_TASKS[day].map((text) => ({ id: newId(), text, done: false })),
    artifacts: [],
    outputs: [],
  }));
}

export interface NewDesignSprintFields {
  name: string;
  /** "YYYY-MM-DD"; day 1 is the first working day on or after it. */
  startDate: string;
  description?: string;
  decider?: string;
  facilitator?: string;
}

/**
 * A new sprint with the default checklist. `currentDay` is only kept for
 * older readers (the day is derived from the start date), so callers pass
 * the day `shownDesignSprintDay` gives for today; 1 when they can't tell.
 */
export function newDesignSprintPlan(
  fields: NewDesignSprintFields,
  {
    id,
    currentDay = 1,
    newId = randomId,
  }: { id?: string; currentDay?: DesignSprintDayNumber; newId?: () => string } = {}
): DesignSprintPlan {
  return {
    id: id ?? newId(),
    name: fields.name,
    startDate: fields.startDate,
    currentDay,
    days: buildDesignSprintDays(newId),
    ...(fields.description ? { description: fields.description } : {}),
    ...(fields.decider ? { decider: fields.decider } : {}),
    ...(fields.facilitator ? { facilitator: fields.facilitator } : {}),
  };
}
