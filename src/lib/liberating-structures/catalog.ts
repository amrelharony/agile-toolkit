/**
 * The Liberating Structures the picker offers, shared by the page, its AI
 * prompt and the tool.liberating_structures.* agent actions, so they agree
 * on what each structure is for, who it fits and how it runs.
 *
 * Moved out of the page so the catalog carries data instead of prose:
 * purposes and ceremonies to filter on, a people range instead of one size
 * bucket (1-2-4-All was "medium (8-30)" though it runs from four people
 * up, so a team of eight lost Troika and 9 Whys), and the steps with their
 * minutes, which the page's step timer runs one by one on the docked
 * timer. Timings follow the structures as liberatingstructures.com
 * describes them; the wording is ours.
 *
 * The ids are saved: users' favourites (`LsFavorite.structureId`) and the
 * agent actions use them, so an id never changes.
 */

import type { CeremonyKind } from "@/lib/sprints/cadence";

/** What a group should leave with, the first question when choosing a structure. */
export type LsPurpose =
  | "ideas"
  | "connect"
  | "plan"
  | "get-help"
  | "prioritize"
  | "make-sense"
  | "stop-doing"
  | "self-organize";

export const LS_PURPOSES: readonly LsPurpose[] = [
  "ideas",
  "prioritize",
  "get-help",
  "make-sense",
  "stop-doing",
  "plan",
  "connect",
  "self-organize",
];

/** For chips and sentences: "Ideas", "Get help". */
export const LS_PURPOSE_LABEL: Record<LsPurpose, string> = {
  ideas: "Ideas",
  connect: "Connect",
  plan: "Plan",
  "get-help": "Get help",
  prioritize: "Prioritize",
  "make-sense": "Make sense",
  "stop-doing": "Stop doing",
  "self-organize": "Self-organize",
};

/** One timed part of a structure, as the step timer runs it. */
export interface LsStep {
  /** Stable within its structure. */
  id: string;
  label: string;
  minutes: number;
  /** What happens in it, one sentence. */
  hint: string;
}

export interface LsStructure {
  /** Saved in favourites: never changes. */
  id: string;
  name: string;
  /** What it's for, one sentence. */
  purpose: string;
  /** What it's for, as filters. */
  purposes: LsPurpose[];
  /** The Scrum events it suits; empty when it's a workshop of its own. */
  ceremonies: CeremonyKind[];
  /** The fewest people it works with. */
  minPeople: number;
  /** The most, or null when it scales to any size (in groups or tables). */
  maxPeople: number | null;
  /** The timing as people say it: "12 min", "60-95 min". */
  timing: string;
  /** The planned length in minutes, for the timing filter. */
  timingMinutes: number;
  description: string;
  source: string;
  /** The steps with their minutes; null when it runs as one open session. */
  steps: LsStep[] | null;
  /** The Ceremony Timer agenda that runs it, when there is one. */
  ceremonyTimerAgenda?: "one-two-four-all";
}

/** Where the structures come from, linked under each card. */
export const LS_SOURCE_URL = "https://www.liberatingstructures.com/";

const SOURCE = "liberatingstructures.com";

/** Numbered rounds of the same step: "Round 1 of 5", "Round 2 of 5", … */
function rounds(count: number, minutes: number, label: string, hint: string): LsStep[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `round-${i + 1}`,
    label: `${label} (round ${i + 1} of ${count})`,
    minutes,
    hint,
  }));
}

export const LS_CATALOG: readonly LsStructure[] = [
  {
    id: "ls-1-2-4-all",
    name: "1-2-4-All",
    purpose: "Engage everyone simultaneously in generating questions, ideas, and suggestions",
    purposes: ["ideas"],
    ceremonies: ["retro", "planning", "review", "refinement"],
    minPeople: 4,
    maxPeople: null,
    timing: "12 min",
    timingMinutes: 12,
    description:
      "Silent reflection (1 min) → pairs (2 min) → quartets (4 min) → whole group (5 min). Ensures everyone speaks before the loud voices anchor the room.",
    source: SOURCE,
    steps: [
      { id: "one", label: "1: alone", minutes: 1, hint: "Think about the question in silence." },
      { id: "two", label: "2: in pairs", minutes: 2, hint: "Build on each other's ideas." },
      {
        id: "four",
        label: "4: in fours",
        minutes: 4,
        hint: "Notice the similarities and differences.",
      },
      {
        id: "all",
        label: "All: whole group",
        minutes: 5,
        hint: "Each group shares one idea that stood out.",
      },
    ],
    ceremonyTimerAgenda: "one-two-four-all",
  },
  {
    id: "ls-impromptu",
    name: "Impromptu Networking",
    purpose: "Rapidly share challenges and expectations, build connections",
    purposes: ["connect"],
    ceremonies: ["review", "retro"],
    // Three rounds with a new partner each time: four people is the
    // smallest group where nobody meets the same person twice.
    minPeople: 4,
    maxPeople: null,
    timing: "15-20 min",
    timingMinutes: 18,
    description:
      "Three rounds of paired conversations on the same two questions, a new partner each round, about two minutes each way. Standing up. Great as an opener that breaks cliques.",
    source: SOURCE,
    steps: [
      {
        id: "invite",
        label: "Ask the questions",
        minutes: 2,
        hint: "Put up the two questions: the challenge you bring, and what you hope to get.",
      },
      ...rounds(3, 4, "Pairs", "Find someone you know least; two minutes each, then move on."),
      {
        id: "debrief",
        label: "Debrief",
        minutes: 4,
        hint: "Ask the whole group which patterns and surprises came up.",
      },
    ],
  },
  {
    id: "ls-9-whys",
    name: "9 Whys",
    purpose: "Make the purpose of work together clear",
    purposes: ["plan"],
    ceremonies: ["planning"],
    minPeople: 2,
    maxPeople: null,
    timing: "20 min",
    timingMinutes: 20,
    description:
      "Pairs ask each other 'Why is that important to you?' up to 9 times. Surfaces the deepest motivation behind a goal in a way other framings miss.",
    source: SOURCE,
    steps: [
      {
        id: "setup",
        label: "Set up",
        minutes: 2,
        hint: "Name the work, then pair people up.",
      },
      {
        id: "first",
        label: "First person is asked",
        minutes: 8,
        hint: "Ask what they do, then 'Why is that important to you?' until the purpose is clear.",
      },
      {
        id: "second",
        label: "Second person is asked",
        minutes: 8,
        hint: "Swap roles and dig as deep.",
      },
      {
        id: "share",
        label: "Share purposes",
        minutes: 2,
        hint: "Each pair shares the purpose statement they arrived at.",
      },
    ],
  },
  {
    id: "ls-wise-crowds",
    name: "Wise Crowds",
    purpose: "Tap the wisdom of the whole group in rapid cycles",
    purposes: ["get-help"],
    ceremonies: ["retro", "refinement"],
    // A client and at least three consultants; with three people it is
    // Troika Consulting.
    minPeople: 4,
    maxPeople: null,
    timing: "15 min per round",
    timingMinutes: 15,
    description:
      "A client presents a challenge for 2 min, the group asks clarifying questions, the client turns their back, and the group discusses while the client listens, then the client reflects.",
    source: SOURCE,
    steps: [
      {
        id: "present",
        label: "Client presents",
        minutes: 2,
        hint: "The client describes the challenge and the help they want.",
      },
      {
        id: "questions",
        label: "Clarifying questions",
        minutes: 3,
        hint: "Consultants ask questions; no advice yet.",
      },
      {
        id: "consult",
        label: "Consult, client's back turned",
        minutes: 8,
        hint: "The client listens and takes notes while the consultants talk it through.",
      },
      {
        id: "reflect",
        label: "Client reflects",
        minutes: 2,
        hint: "The client says what was useful. Start again for the next client.",
      },
    ],
  },
  {
    id: "ls-25-10",
    name: "25/10 Crowd Sourcing",
    purpose: "Quickly surface and prioritize the group's boldest ideas",
    purposes: ["prioritize", "ideas"],
    ceremonies: ["retro", "planning"],
    // Five rounds of passing cards need enough people that a card meets
    // five new readers.
    minPeople: 10,
    maxPeople: null,
    timing: "30 min",
    timingMinutes: 30,
    description:
      "Each person writes their boldest idea on a card, then 5 rounds of swap-and-rate (1-5). Top-rated ideas surface without the loudest-voice bias of open discussion.",
    source: SOURCE,
    steps: [
      {
        id: "write",
        label: "Write a bold idea",
        minutes: 5,
        hint: "Each person writes one bold idea and its first step on a card.",
      },
      ...rounds(
        5,
        3,
        "Pass and score",
        "Mill around, swap cards until the bell, then score the card in hand from 1 to 5."
      ),
      {
        id: "tally",
        label: "Add up the scores",
        minutes: 5,
        hint: "Each card's five scores are added; count down from 25 to find the top ten.",
      },
      {
        id: "share",
        label: "Share the top ten",
        minutes: 5,
        hint: "Read out the top ideas and ask who wants to take them forward.",
      },
    ],
  },
  {
    id: "ls-troika",
    name: "Troika Consulting",
    purpose: "Get practical and imaginative help from peers immediately",
    purposes: ["get-help"],
    ceremonies: ["retro"],
    // Trios: any group of three or more, in parallel.
    minPeople: 3,
    maxPeople: null,
    timing: "30 min",
    timingMinutes: 30,
    description:
      "Trios; each person gets 7-10 min as 'client'. Client describes the challenge (1-2 min), turns away, and consultants discuss while client listens, then client reflects on what was useful.",
    source: SOURCE,
    steps: rounds(
      3,
      10,
      "Consult",
      "The client asks (2 min), the others talk with the client's back turned, then the client says what helped."
    ),
  },
  {
    id: "ls-winfy",
    name: "What I Need From You (WINFY)",
    purpose: "Surface essential requests across functions to clear blockers",
    purposes: ["plan"],
    ceremonies: ["planning"],
    minPeople: 8,
    maxPeople: null,
    timing: "55-70 min",
    timingMinutes: 60,
    description:
      "Each function makes 2-3 specific 'what I need from you' requests of each other function. Requests are then answered with yes / no / whatever / I'll try, with no negotiation in the moment.",
    source: SOURCE,
    steps: [
      {
        id: "requests",
        label: "Write requests",
        minutes: 15,
        hint: "Each function writes its two most important requests for each other function.",
      },
      {
        id: "deliver",
        label: "Deliver requests",
        minutes: 15,
        hint: "Spokespeople read the requests out; no replies yet.",
      },
      {
        id: "responses",
        label: "Write answers",
        minutes: 15,
        hint: "Each function decides its answer to every request it received.",
      },
      {
        id: "answer",
        label: "Give answers",
        minutes: 15,
        hint: "Yes, no, I'll try or whatever, with no negotiation in the moment.",
      },
    ],
  },
  {
    id: "ls-dad",
    name: "Discovery & Action Dialogue (DAD)",
    purpose: "Discover, invent, and unleash local solutions to chronic problems",
    purposes: ["make-sense"],
    ceremonies: ["retro"],
    minPeople: 8,
    maxPeople: null,
    timing: "25-70 min",
    timingMinutes: 50,
    description:
      "A 7-question protocol that draws out 'positive deviants' — people already solving the problem — and invites the group to invent next steps together.",
    source: SOURCE,
    // One open dialogue through the seven questions, at the group's pace.
    steps: null,
  },
  {
    id: "ls-ecocycle",
    name: "Ecocycle Planning",
    purpose: "Analyze the full portfolio of activities to identify obstacles and opportunities",
    purposes: ["plan"],
    ceremonies: ["review", "planning"],
    minPeople: 4,
    maxPeople: null,
    timing: "60-95 min",
    timingMinutes: 75,
    description:
      "Map every activity onto a 4-stage ecocycle (birth, maturity, creative destruction, renewal). Surfaces 'rigidity traps' (doing too much) and 'poverty traps' (starving the new).",
    source: SOURCE,
    steps: [
      {
        id: "intro",
        label: "Introduce the ecocycle",
        minutes: 5,
        hint: "Show the four stages and the two traps.",
      },
      {
        id: "list",
        label: "List activities alone",
        minutes: 5,
        hint: "Each person lists the activities the group spends time on.",
      },
      {
        id: "pairs",
        label: "Place them in pairs",
        minutes: 10,
        hint: "Agree where each activity sits on the cycle.",
      },
      {
        id: "fours",
        label: "Map in fours",
        minutes: 20,
        hint: "Put the activities on the shared map.",
      },
      {
        id: "group",
        label: "Read the whole map",
        minutes: 15,
        hint: "Look for clusters, traps and what's missing.",
      },
      {
        id: "act",
        label: "Plan next steps",
        minutes: 20,
        hint: "Decide what to stop, start, grow or let go of.",
      },
    ],
  },
  {
    id: "ls-cafe",
    name: "Conversation Café",
    purpose: "Engage everyone in making sense of profound challenges",
    purposes: ["make-sense"],
    ceremonies: ["retro"],
    // Tables of five to seven; more people means more tables.
    minPeople: 5,
    maxPeople: null,
    timing: "60-90 min",
    timingMinutes: 75,
    description:
      "Tables of 5-7 hold rounds of conversation guided by 6 agreements (e.g. 'speak with intention'). Two rounds with a talking object then open dialogue.",
    source: SOURCE,
    steps: [
      {
        id: "agree",
        label: "Agreements and question",
        minutes: 5,
        hint: "Read the agreements and the question.",
      },
      {
        id: "round-1",
        label: "Round 1: talking object",
        minutes: 10,
        hint: "Each person in turn says what they think and feel; no replies.",
      },
      {
        id: "round-2",
        label: "Round 2: talking object",
        minutes: 10,
        hint: "Each person in turn adds what they heard and how it moved them.",
      },
      {
        id: "open",
        label: "Open conversation",
        minutes: 40,
        hint: "Talk freely; the agreements still hold.",
      },
      {
        id: "final",
        label: "Final round: takeaways",
        minutes: 10,
        hint: "Each person says what they take away.",
      },
    ],
  },
  {
    id: "ls-triz",
    name: "TRIZ",
    purpose: "Make space for innovation by stopping counterproductive activities",
    purposes: ["stop-doing"],
    ceremonies: ["retro"],
    minPeople: 4,
    maxPeople: null,
    timing: "35 min",
    timingMinutes: 35,
    description:
      "Three rounds: (1) make a list of how to achieve the worst possible result, (2) match items to what you currently do, (3) decide what to stop doing.",
    source: SOURCE,
    steps: [
      {
        id: "setup",
        label: "Set up the question",
        minutes: 5,
        hint: "Name the result you want, then turn it around: how do we get the worst?",
      },
      {
        id: "worst",
        label: "List the worst outcomes",
        minutes: 10,
        hint: "In small groups, list everything that would guarantee the worst result.",
      },
      {
        id: "match",
        label: "Match to what we do now",
        minutes: 10,
        hint: "Mark each item that resembles something you already do.",
      },
      {
        id: "stop",
        label: "Decide what to stop",
        minutes: 10,
        hint: "Pick the first step to stop each marked item.",
      },
    ],
  },
  {
    id: "ls-open-space",
    name: "Open Space Technology",
    purpose: "Liberate inherent action and leadership in large groups",
    purposes: ["self-organize"],
    ceremonies: [],
    minPeople: 20,
    maxPeople: null,
    timing: "90 min – 3 days",
    timingMinutes: 180,
    description:
      "Participants self-organize sessions around a single overarching question. Governed by the Law of Two Feet: if you're not learning or contributing, move.",
    source: SOURCE,
    // Sessions run in parallel at the participants' pace: no shared clock.
    steps: null,
  },
];

const BY_ID = new Map(LS_CATALOG.map((s) => [s.id, s]));

/** The structure with this id, if the catalog has it. */
export function lsStructure(id: string | null | undefined): LsStructure | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isLsStructureId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

/** Whether `people` can run it; null (not given) fits every structure. */
export function fitsGroup(s: LsStructure, people: number | null): boolean {
  if (people === null) return true;
  return people >= s.minPeople && (s.maxPeople === null || people <= s.maxPeople);
}

/** "4+ people", "5–30 people". */
export function lsPeopleLabel(s: LsStructure): string {
  return s.maxPeople === null ? `${s.minPeople}+ people` : `${s.minPeople}–${s.maxPeople} people`;
}

/** The steps' total in minutes, or null for a structure without steps. */
export function stepsMinutes(s: LsStructure): number | null {
  if (!s.steps) return null;
  return s.steps.reduce((sum, step) => sum + Math.max(0, step.minutes), 0);
}
