import { exampleId } from "@/components/tool-frame/example-data";
import type {
  DesignSprintDayNumber,
  DesignSprintOutput,
  DesignSprintPlan,
} from "@/lib/stores/workspace-types";
import {
  DEFAULT_DESIGN_SPRINT_TASKS,
  DESIGN_SPRINT_DAY_NAMES,
  DESIGN_SPRINT_DAY_NUMBERS,
} from "@/lib/design-sprint/plan";
import {
  DEFAULT_CALENDAR,
  isoDayNumber,
  isoFromDayNumber,
  isWorkingDay,
  type WorkingCalendar,
} from "@/lib/sprints/calendar";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * A grocery-delivery team's design sprint, on Test day: new customers drop
 * out before their first order, and the team prototyped a pre-filled
 * "starter basket". Map, Sketch, Decide and Prototype are done; today the
 * five interviews ran and four findings are written up, one of them bad
 * news about the delivery fee. The sprint questions are answered yes, no
 * and unclear.
 *
 * It starts four working days before today (the team's working days), so
 * the page derives "Day 5 of 5 · Test", or "Over" on a day off. Every id
 * is an example id: "Clear example" removes the plan, and its findings
 * can't be sent to the Hypothesis Tracker or the backlog.
 */

export const EXAMPLE_PLAN_ID = exampleId("design-sprint");

const DECIDER = "Amira";
const FACILITATOR = "Ben";

/** Tasks left open on Test day (index into the day's default tasks). */
const OPEN_ON_TEST_DAY = new Set([3]);

const OWNERS: Partial<Record<`${DesignSprintDayNumber}-${number}`, string>> = {
  "1-0": DECIDER,
  "1-5": DECIDER,
  "2-3": "Dev",
  "3-3": DECIDER,
  "4-2": "Chloé",
  "5-0": FACILITATOR,
  "5-3": DECIDER,
};

type Seed = Omit<DesignSprintOutput, "id"> & { key: string };

const OUTPUTS: Record<DesignSprintDayNumber, Seed[]> = {
  1: [
    {
      key: "goal",
      kind: "long-term-goal",
      text: "In two years, a new customer places their first order within three minutes of opening the app.",
    },
    {
      key: "q-trust",
      kind: "sprint-question",
      text: "Will new customers trust a basket we fill in for them?",
      answer: "yes",
    },
    {
      key: "q-fee",
      kind: "sprint-question",
      text: "Will they enter card details before they see the delivery fee?",
      answer: "no",
    },
    {
      key: "q-slot",
      kind: "sprint-question",
      text: "Can they pick a delivery slot without help?",
      answer: "unclear",
    },
    {
      key: "target",
      kind: "target",
      text: "A first-time customer, between signing up and adding the first item to the basket.",
    },
  ],
  2: [
    {
      key: "sketch-basket",
      kind: "sketch",
      text: "Starter basket: the five items most bought nearby, ready to edit",
      url: "https://example.com/sketches/starter-basket",
    },
    { key: "sketch-recipe", kind: "sketch", text: "Recipe-first home screen" },
    { key: "sketch-chat", kind: "sketch", text: "Chat-style order assistant" },
  ],
  3: [
    {
      key: "decision",
      kind: "decision",
      text: "Build the starter basket, with the delivery-slot picker from the recipe sketch.",
    },
    {
      key: "storyboard",
      kind: "storyboard",
      text: "Twelve panels, from the app-store listing to the order confirmation",
    },
  ],
  4: [
    {
      key: "prototype",
      kind: "prototype",
      text: "Clickable prototype: starter basket to checkout",
      url: "https://example.com/prototypes/starter-basket",
    },
  ],
  5: [
    {
      key: "f-kept",
      kind: "finding",
      text: "Customers kept the starter basket and edited it rather than starting over.",
      signal: "positive",
      seenIn: 4,
    },
    {
      key: "f-fee",
      kind: "finding",
      text: "Customers looked for the delivery fee before they would enter card details.",
      signal: "negative",
      seenIn: 5,
    },
    {
      key: "f-slot",
      kind: "finding",
      text: "The delivery-slot picker was missed below the fold.",
      signal: "mixed",
      seenIn: 3,
    },
    {
      key: "f-weekly",
      kind: "finding",
      text: "Customers asked to save the basket as a weekly order.",
      signal: "positive",
      seenIn: 2,
    },
  ],
};

/**
 * The start date that puts `today` on Test day: four working days before
 * the last working day on or before today.
 */
export function exampleStartDate(
  today: string = todayLocalISO(),
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): string {
  let n = isoDayNumber(today) ?? isoDayNumber(todayLocalISO())!;
  // A calendar always has a working weekday; the guards only stop a bad one looping.
  for (let guard = 0; guard < 3660 && !isWorkingDay(isoFromDayNumber(n), calendar); guard++) n--;
  for (let back = 4, guard = 0; back > 0 && guard < 3660; guard++) {
    n--;
    if (isWorkingDay(isoFromDayNumber(n), calendar)) back--;
  }
  return isoFromDayNumber(n);
}

export function buildExample(
  today: string = todayLocalISO(),
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): DesignSprintPlan {
  return {
    id: EXAMPLE_PLAN_ID,
    name: "Faster first order",
    startDate: exampleStartDate(today, calendar),
    currentDay: 5,
    description:
      "New customers drop out before they place their first order. Could a basket we fill in for them get them to checkout?",
    decider: DECIDER,
    facilitator: FACILITATOR,
    days: DESIGN_SPRINT_DAY_NUMBERS.map((day) => ({
      day,
      dayName: DESIGN_SPRINT_DAY_NAMES[day],
      tasks: DEFAULT_DESIGN_SPRINT_TASKS[day].map((text, i) => {
        const owner = OWNERS[`${day}-${i}`];
        return {
          id: exampleId(`ds-task-${day}-${i + 1}`),
          text,
          done: day < 5 || !OPEN_ON_TEST_DAY.has(i),
          ...(owner ? { owner } : {}),
        };
      }),
      artifacts: [],
      outputs: OUTPUTS[day].map(({ key, ...seed }) => ({ ...seed, id: exampleId(`ds-${key}`) })),
    })),
  };
}
