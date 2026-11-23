/**
 * Quick Vote's formats: one tap starts a round of the right kind with the
 * right answers (fist of five, ROTI, a poll, dot voting, value poker …).
 *
 * Every word here is our own: the scales' labels, the gradient of
 * agreement, the safety check's levels and the feelings words. The names of
 * the techniques (Fist of five, ROTI, ESVP, ELMO) are the common names
 * facilitators use for them.
 *
 * Pure data, server-safe: the page, the round checks (./draft.ts) and Amr's
 * actions (lib/actions/tools/quick-vote.ts) read the same list. It imports
 * nothing from the vote kit; ./sheets.ts turns a checked round into the
 * kit's questionnaire or sheet.
 */

import { FIBONACCI_STEPS } from "@/lib/prioritization/methods/fibonacci";

/** The kinds of round Quick Vote runs (the kit's `scale`, `choice`, `rank` and `number`). */
export type QuickVoteKind = "scale" | "choice" | "rank" | "number";

/** How people answer a choice round: one option, several, or dots. */
export type QuickVoteMode = "single" | "multi" | "dots";

export const QUICK_VOTE_MODES = [
  "single",
  "multi",
  "dots",
] as const satisfies readonly QuickVoteMode[];

/** One answer on a scale: what it counts as, and its label. */
export interface PresetPoint {
  value: number;
  label: string;
}

/** One option of a choice or rank round. */
export interface PresetOption {
  text: string;
  hint?: string;
}

export const PRESET_IDS = [
  "fist-of-five",
  "roman",
  "confidence",
  "roti",
  "custom-scale",
  "poll",
  "ranking",
  "consent",
  "elmo",
  "dots",
  "esvp",
  "safety-check",
  "guess-number",
  "feelings",
  "perfection",
  "value-poker",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === "string" && (PRESET_IDS as readonly string[]).includes(v);
}

/**
 * What a round of the format lets you change beyond the question:
 *  - "none": the answers are the format's own;
 *  - "options": your own options (poll, ranking, dot voting);
 *  - "labels": your own scale (custom scale);
 *  - "range": the lowest and highest answer and a unit (guess the number);
 *  - "item": the backlog item being valued (value poker);
 *  - "feelings": which step of the feelings wheel.
 */
export type PresetEditable = "none" | "options" | "labels" | "range" | "item" | "feelings";

export interface QuickVotePreset {
  id: PresetId;
  name: string;
  /** What it's for, in one line. */
  blurb: string;
  kind: QuickVoteKind;
  /** The question a new round starts with. */
  question: string;
  editable: PresetEditable;
  /** Scale formats: the scale, lowest first (custom scale: the labels it starts with). */
  points?: readonly PresetPoint[];
  /** Choice formats with answers of their own. */
  options?: readonly PresetOption[];
  /** Choice formats: how people answer. */
  mode?: QuickVoteMode;
  /** Dot voting: the dots each person starts with. */
  limit?: number;
  /** Answers needed before the results show; absent: the kit's 3. */
  minN?: number;
  /** A round left open while the meeting goes on (ELMO and live signals). */
  standing?: boolean;
  /** Guess the number: the range a round starts with. */
  range?: { min: number; max: number; decimals: 0 | 1 | 2; unit: string };
  /**
   * Whether hold-up cards can show its answers: scale and choice formats,
   * never one whose answers stay anonymous (ESVP, the safety check), as a
   * card held up shows the room who picked what.
   */
  cards: boolean;
  /** How to run it well, in a sentence. */
  tip: string;
}

/** Five answers a round shows from, for the formats that ask about people (as Psych Safety does). */
export const SENSITIVE_MIN_N = 5;

/**
 * The feelings wheel: six core feelings, each with six finer words. Our own
 * short list, plain words a team uses at a check-in.
 */
export const FEELINGS: readonly { core: string; finer: readonly string[] }[] = [
  { core: "Glad", finer: ["Proud", "Hopeful", "Grateful", "Playful", "Relieved", "Confident"] },
  { core: "Calm", finer: ["Relaxed", "Steady", "Content", "Focused", "Patient", "Rested"] },
  { core: "Sad", finer: ["Disappointed", "Lonely", "Low", "Discouraged", "Left out", "Weary"] },
  {
    core: "Worried",
    finer: ["Nervous", "Unsure", "Overwhelmed", "Stretched", "Uneasy", "Under pressure"],
  },
  {
    core: "Cross",
    finer: ["Frustrated", "Irritated", "Impatient", "Let down", "Stuck", "Resentful"],
  },
  {
    core: "Surprised",
    finer: ["Curious", "Amazed", "Confused", "Startled", "Excited", "Puzzled"],
  },
];

/** The core feeling named `core` (any case), or undefined. */
export function feelingCore(core: string | null | undefined) {
  if (!core) return undefined;
  const want = core.trim().toLowerCase();
  return FEELINGS.find((f) => f.core.toLowerCase() === want);
}

/** The question each step of the feelings wheel starts with. */
export function feelingsQuestion(core: string | null | undefined): string {
  const found = feelingCore(core);
  return found
    ? `You picked ${found.core.toLowerCase()}: which word fits best?`
    : "Which feeling is closest to how you are right now?";
}

/** The options of a feelings round: the core feelings, or one core's finer words. */
export function feelingsOptions(core: string | null | undefined): PresetOption[] {
  const found = feelingCore(core);
  return found ? found.finer.map((text) => ({ text })) : FEELINGS.map((f) => ({ text: f.core }));
}

const points = (labels: readonly string[], first: number): PresetPoint[] =>
  labels.map((label, i) => ({ value: first + i, label }));

/** The answers of value poker: the backlog's one value scale (1, 2, 3, 5, 8, 13, 20). */
export const VALUE_POKER_OPTIONS: readonly PresetOption[] = FIBONACCI_STEPS.map((s) => ({
  text: String(s.value),
  hint: s.meaning,
}));

/** The built-in formats, in the order the picker shows them. */
export const QUICK_VOTE_PRESETS: readonly QuickVotePreset[] = [
  {
    id: "fist-of-five",
    name: "Fist of five",
    blurb: "Support for a plan, from a fist (block) to five fingers.",
    kind: "scale",
    question: "How much do you support this plan?",
    editable: "none",
    points: points(
      [
        "Fist: I block this",
        "1: I have serious concerns",
        "2: I have some concerns",
        "3: I can go with it",
        "4: I like it",
        "5: Full support",
      ],
      0
    ),
    cards: true,
    tip: "Agree what a fist means before you ask, and hear out anyone under 3.",
  },
  {
    id: "roman",
    name: "Roman vote",
    blurb: "Thumbs up, sideways or down for a quick yes or no.",
    kind: "choice",
    question: "Do we go ahead with this?",
    editable: "none",
    mode: "single",
    options: [
      { text: "Thumbs up", hint: "Yes, I'm for it" },
      { text: "Sideways", hint: "I can go either way" },
      { text: "Thumbs down", hint: "No, I'm against it" },
    ],
    cards: true,
    tip: "Good for small calls. One thumbs down is worth hearing out before you move on.",
  },
  {
    id: "confidence",
    name: "Confidence vote",
    blurb: "How sure the team is about a plan, from 1 to 5.",
    kind: "scale",
    question: "How confident are you that we'll meet this plan?",
    editable: "none",
    points: points(["1: Not at all", "2: Not very", "3: Fairly", "4: Very", "5: Completely"], 1),
    cards: true,
    tip: "Run it as Sprint Planning ends, and talk about every vote under 3 before you commit.",
  },
  {
    id: "roti",
    name: "ROTI",
    blurb: "Return on time invested: was the meeting worth it?",
    kind: "scale",
    question: "How much was this meeting worth the time you gave it?",
    editable: "none",
    points: points(
      [
        "0: A waste of my time",
        "1: Less than I gave",
        "2: About what I gave",
        "3: More than I gave",
        "4: Far more than I gave",
      ],
      0
    ),
    cards: true,
    tip: "Ask in the last two minutes, and ask a low vote what would have made it worth it.",
  },
  {
    id: "custom-scale",
    name: "Custom scale",
    blurb: "Your own scale, with your own labels.",
    kind: "scale",
    question: "How would you rate this?",
    editable: "labels",
    points: points(["Low", "Medium", "High"], 1),
    cards: true,
    tip: "Two to eleven answers, lowest first. Plain labels beat numbers alone.",
  },
  {
    id: "poll",
    name: "Poll",
    blurb: "Pick one option, or several, from your own list.",
    kind: "choice",
    question: "Which do you prefer?",
    editable: "options",
    mode: "single",
    cards: true,
    tip: "Keep the options short and different from each other, and offer a way out if it helps.",
  },
  {
    id: "ranking",
    name: "Ranking",
    blurb: "Put your options in order, most important first.",
    kind: "rank",
    question: "Put these in order, most important first.",
    editable: "options",
    cards: false,
    tip: "Up to ten options. Talk about the ones people placed far apart.",
  },
  {
    id: "consent",
    name: "Gradients of agreement",
    blurb: "Where each person stands on a proposal, on eight steps.",
    kind: "choice",
    question: "Where do you stand on this proposal?",
    editable: "none",
    mode: "single",
    options: [
      { text: "Fully in favour" },
      { text: "In favour" },
      { text: "In favour, with a few doubts" },
      { text: "I can live with it" },
      { text: "Mixed: we need more talk" },
      { text: "Not in favour, but I won't block" },
      { text: "Serious concerns: change it first" },
      { text: "I block this" },
    ],
    cards: true,
    tip: "Anything below “I can live with it” is a reason to talk, not to vote again.",
  },
  {
    id: "elmo",
    name: "ELMO and live signals",
    blurb: "A standing round: keep going, move on, slow down or louder.",
    kind: "choice",
    question: "How is this conversation going for you?",
    editable: "none",
    mode: "single",
    standing: true,
    options: [
      { text: "Keep going" },
      { text: "Enough, let's move on" },
      { text: "Slow down" },
      { text: "Louder, please" },
    ],
    cards: true,
    tip: "Leave it open while you talk, reveal for a quick read, then start a new round to keep listening.",
  },
  {
    id: "dots",
    name: "Dot voting",
    blurb: "Spread a few dots across a list, from the backlog, the retro or your own.",
    kind: "choice",
    question: "Where should we spend our time?",
    editable: "options",
    mode: "dots",
    limit: 3,
    cards: false,
    tip: "Three dots each is a good start. Talk about the top few, not every dot.",
  },
  {
    id: "esvp",
    name: "ESVP",
    blurb: "Explorer, shopper, vacationer or prisoner: why people are here.",
    kind: "choice",
    question: "Which best describes how you feel about being here today?",
    editable: "none",
    mode: "single",
    minN: SENSITIVE_MIN_N,
    options: [
      { text: "Explorer", hint: "Keen to find new ideas and learn" },
      { text: "Shopper", hint: "I'll take away a useful idea or two" },
      { text: "Vacationer", hint: "Glad of a break from the day job" },
      { text: "Prisoner", hint: "I'd rather be somewhere else" },
    ],
    cards: false,
    tip: "Results show from 5 answers. Talk about the room, never about who picked what.",
  },
  {
    id: "safety-check",
    name: "Safety check",
    blurb: "How safe people feel speaking up, from 1 to 5.",
    kind: "scale",
    question: "How safe do you feel speaking up in this session?",
    editable: "none",
    minN: SENSITIVE_MIN_N,
    points: points(
      [
        "1: I'll keep quiet here",
        "2: I'll stick to safe topics",
        "3: I'll share some of it",
        "4: I'll say most of it",
        "5: I'll say anything here",
      ],
      1
    ),
    cards: false,
    tip: "Results show from 5 answers. A low score changes how you run the session, not who you ask.",
  },
  {
    id: "guess-number",
    name: "Guess the number",
    blurb: "Everyone guesses a number; add the real answer later to see the spread.",
    kind: "number",
    question: "How many days will this take?",
    editable: "range",
    range: { min: 0, max: 100, decimals: 0, unit: "days" },
    cards: false,
    tip: "Keep the real answer to yourself until everyone has guessed, then add it to the saved result.",
  },
  {
    id: "feelings",
    name: "Feelings wheel",
    blurb: "A core feeling first, then a finer word for it.",
    kind: "choice",
    question: feelingsQuestion(null),
    editable: "feelings",
    mode: "single",
    cards: true,
    tip: "Run the core feelings first, then the finer words for the one most people picked.",
  },
  {
    id: "perfection",
    name: "Perfection game",
    blurb: "Rate it from 1 to 10, then ask what would make it a 10.",
    kind: "scale",
    question: "How close is this to perfect, from 1 to 10?",
    editable: "none",
    points: points(
      ["1: Far from it", "2", "3", "4", "5", "6", "7", "8", "9", "10: Perfect as it is"],
      1
    ),
    cards: true,
    tip: "A score is only half of it: collect what would make it a 10 on the Audience Wall.",
  },
  {
    id: "value-poker",
    name: "Value poker",
    blurb: "Business value for a backlog item, on 1, 2, 3, 5, 8, 13 or 20.",
    kind: "choice",
    question: "How much value does this bring, compared with the other items?",
    editable: "item",
    mode: "single",
    options: VALUE_POKER_OPTIONS,
    cards: true,
    tip: "Values are relative to the other items, not money. Save the value to the item only once you agree.",
  },
];

/** The built-in format with this id, or undefined. */
export function presetById(id: unknown): QuickVotePreset | undefined {
  return isPresetId(id) ? QUICK_VOTE_PRESETS.find((p) => p.id === id) : undefined;
}

/** The answers a format offers as plain text, in order (feelings: the core feelings). */
export function presetAnswers(p: QuickVotePreset): string[] {
  if (p.points) return p.points.map((x) => x.label);
  if (p.id === "feelings") return feelingsOptions(null).map((x) => x.text);
  return (p.options ?? []).map((x) => x.text);
}
