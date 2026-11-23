/**
 * Designing a Kanban system with STATIK, in seven guided steps, and the
 * starter policies the Definition of Workflow offers without AI. Every
 * word here is our own: STATIK names the approach (Kanban University's),
 * and the steps below are a plain-words walk through it, with no Kanban
 * Maturity Model content.
 *
 * Pure, so the page, the AI task's fallback and the tests share one text.
 */

import type { KanbanCadence, StatikNotes } from "@/lib/stores/workspace-types";

/** The credit line shown on the STATIK tab (Decision D5). */
export const STATIK_CREDIT = "STATIK comes from Kanban University; the steps here are in our words";

/** One note a step writes. */
export interface StatikField {
  key: keyof StatikNotes;
  label: string;
  hint: string;
}

export interface StatikStep {
  /** 1 to 7. */
  n: number;
  id: string;
  title: string;
  /** What the step asks, in a sentence. */
  ask: string;
  fields: readonly StatikField[];
}

export const STATIK_STEPS: readonly StatikStep[] = [
  {
    n: 1,
    id: "pain",
    title: "What isn't working",
    ask: "Start from what hurts today, for the people doing the work and for the people waiting on it.",
    fields: [
      {
        key: "inside",
        label: "Inside the team",
        hint: "Too much at once, work that stalls, late surprises.",
      },
      {
        key: "outside",
        label: "For the people we serve",
        hint: "Long waits, missed dates, not knowing when something lands.",
      },
    ],
  },
  {
    n: 2,
    id: "demand",
    title: "What comes in",
    ask: "List the kinds of requests that reach the team, where they come from and how often.",
    fields: [
      {
        key: "demand",
        label: "Kinds of requests",
        hint: "For each: who asks, how many a week, and how urgent they tend to be.",
      },
    ],
  },
  {
    n: 3,
    id: "capability",
    title: "What we deliver today",
    ask: "Look at what the board already shows: how much finishes and how long it takes. Note what surprises you.",
    fields: [
      {
        key: "capability",
        label: "What the numbers say",
        hint: "Is it what people expect? Where does work wait longest?",
      },
    ],
  },
  {
    n: 4,
    id: "workflow",
    title: "How work moves",
    ask: "Walk one item from request to done and name each step where it is worked on or waits.",
    fields: [
      {
        key: "workflow",
        label: "The steps work goes through",
        hint: "Where does work wait for someone? Where does it come back?",
      },
    ],
  },
  {
    n: 5,
    id: "classes",
    title: "Classes of service",
    ask: "Decide which work is handled differently: urgent fixes, fixed dates, improvements with no deadline.",
    fields: [
      {
        key: "classes",
        label: "How each kind is treated",
        hint: "What jumps the queue, what is planned back from a date, what waits.",
      },
    ],
  },
  {
    n: 6,
    id: "design",
    title: "Board design",
    ask: "Sketch the board: its columns, the WIP limit on each, and the policies written on it.",
    fields: [
      {
        key: "design",
        label: "Columns, limits and policies",
        hint: "Start with limits a little below what the team carries today.",
      },
    ],
  },
  {
    n: 7,
    id: "rollout",
    title: "Cadences and trying it out",
    ask: "Agree when the team looks at the board together, then try it for a few weeks and review.",
    fields: [
      {
        key: "rollout",
        label: "How we'll try it",
        hint: "How long the trial runs, and what would make us change it.",
      },
    ],
  },
];

export const STATIK_STEP_COUNT = STATIK_STEPS.length;

/**
 * Which steps have something written: a step with a note, and step 7 also
 * when a cadence is listed. `done` of 7.
 */
export function statikProgress(
  notes: StatikNotes | null | undefined,
  cadences: readonly KanbanCadence[] | null | undefined = []
): { done: number; total: number; steps: boolean[] } {
  const steps = STATIK_STEPS.map((step) => {
    const written = step.fields.some((f) => Boolean(notes?.[f.key]?.trim()));
    return written || (step.id === "rollout" && (cadences?.length ?? 0) > 0);
  });
  return { done: steps.filter(Boolean).length, total: STATIK_STEP_COUNT, steps };
}

/* ── Starter policies (the AI task's fallback, and "Start from a template") ── */

/** An entry and exit policy per stage id of either board, Done left out. */
export const POLICY_TEMPLATES: Readonly<Record<string, { enter: string; exit: string }>> = {
  backlog: {
    enter: "Anyone can add an item with a title and who asked for it",
    exit: "It has been talked through and is small enough to start",
  },
  ready: {
    enter: "It is clear enough that someone could start it tomorrow",
    exit: "Someone pulls it when they finish other work and WIP allows",
  },
  todo: {
    enter: "It was planned into the sprint and its acceptance is clear",
    exit: "Someone pulls it when they finish other work and WIP allows",
  },
  in_progress: {
    enter: "Pulled by the person who will work on it, never pushed",
    exit: "The work is finished and checked by the person who did it",
  },
  review: {
    enter: "It is ready for someone else to look at",
    exit: "Someone other than the author has checked it and any fixes are in",
  },
};

export const START_TEMPLATE = "When someone pulls the item into In progress";
export const FINISH_TEMPLATE = "When the item meets our Definition of Done";
export const BLOCKER_TEMPLATE =
  "Flag it the day it stops, say why, and raise it at the next stand-up if it isn't moving";

/** Three questions a team can ask itself while it writes the workflow. */
export const STATIK_QUESTIONS: readonly string[] = [
  "Which kind of request waits longest before anyone starts it?",
  "Where does finished work come back to be done again?",
  "What would we stop starting if a column were full?",
];
