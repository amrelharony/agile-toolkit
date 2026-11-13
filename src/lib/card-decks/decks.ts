/**
 * Card Decks' built-in decks: retro prompts, coaching questions, storytelling
 * prompts, story-splitting patterns and appreciation ("Yay!") questions, all
 * written for this toolkit, plus the check-in and check-out decks, which are
 * read from the Ice Breaker's own activities (not copied: a change there
 * shows up here).
 *
 * The story-splitting deck takes its five patterns from Refinement's
 * SPLIT_PATTERNS (spike, path, interface, data, rules): each card is one
 * worked example of one pattern, with the pattern's "how" as its hint.
 *
 * Card ids are fixed: a card's marks (used, starred, hidden) are saved
 * under `<deckId>/<cardId>`, so an id must never be reused for other text.
 *
 * Pure and server-safe: the page, Amr's actions and the AI fallbacks all
 * read the same decks.
 */

import { icebreakers } from "@/lib/constants/icebreakers";
import { SPLIT_PATTERNS, type SplitPattern } from "@/app/(tools)/refinement/invest";

/** One card: what it asks, and optionally a short title and a hint under it. */
export interface DeckCard {
  id: string;
  text: string;
  /** A short name above the text (a split pattern, an activity's name). */
  title?: string;
  /** One line under the text (how a pattern works). */
  hint?: string;
}

/** Where a deck comes from: written here, read from the Ice Breaker, or the team's own. */
export type DeckSource = "built-in" | "icebreaker" | "custom";

export interface Deck {
  id: string;
  name: string;
  /** One line on what the deck is for. */
  blurb: string;
  source: DeckSource;
  cards: readonly DeckCard[];
  /** Words a theme may share with the deck (the AI fallback finds the nearest deck by them). */
  keywords: readonly string[];
}

const numbered = (prefix: string, texts: readonly string[]): DeckCard[] =>
  texts.map((text, i) => ({ id: `${prefix}-${String(i + 1).padStart(2, "0")}`, text }));

// ── Retro prompts ────────────────────────────────────────────────────

const RETRO = numbered("retro", [
  "What helped us most this sprint?",
  "What slowed us down, and when did we first notice it?",
  "What surprised you this sprint?",
  "Which moment would you replay if you could, and what would you do differently?",
  "What did we say we would try last time, and did it help?",
  "Where did work sit waiting the longest this sprint?",
  "What is one thing we should stop doing?",
  "What is one thing we should start trying next sprint?",
  "What do we keep talking about but never change?",
  "When did you feel most in flow this sprint?",
  "What did we learn about the people who use what we build?",
  "What did we learn about how we work together?",
  "Which meeting gave us the most this sprint, and which gave us the least?",
  "What would make the next sprint a little calmer?",
  "Where did we guess when we could have asked?",
  "Which risk turned out bigger, or smaller, than we expected?",
  "What did we finish that we are proud of?",
  "What almost went wrong, and what saved it?",
  "What would a new teammate find confusing about how we work?",
  "What is one question we should have asked at Sprint Planning?",
  "What did we put off, and what did putting it off cost us?",
  "Who helped you this sprint in a way the team may not have seen?",
  "What is one small experiment we could run next sprint?",
  "What did our Definition of Done catch, and what did it miss?",
  "Which habit should we keep exactly as it is?",
  "What would we do differently if we had half the time?",
]);

// ── Coaching questions ───────────────────────────────────────────────

const COACHING = numbered("coach", [
  "What would a good outcome of this conversation look like?",
  "What have you already tried, and what did you learn from it?",
  "If this were solved, what is the first thing you would notice?",
  "What part of this is in your control, and what part isn't?",
  "What is the smallest next step you could take this week?",
  "Who else sees this problem, and how might they describe it?",
  "What are you assuming here that might not be true?",
  "What would you tell a teammate who brought you this problem?",
  "What makes this hard to talk about?",
  "From 1 to 10, how much does this matter to you, and why that number?",
  "What would you need to stop doing to make room for this?",
  "What support would help, and who could give it?",
  "What is the question behind your question?",
  "When have you handled something like this well before?",
  "What would change if you waited a month?",
  "What does the team need from you here, and what do you need from them?",
  "Which option haven't you looked at yet?",
  "What would make this a little easier tomorrow?",
  "How will you know it is working?",
  "What are you hoping I won't ask?",
  "What would you try if it only had to work for one sprint?",
  "Which part of this is a puzzle to solve, and which part is a choice to make?",
  "What gets in the way when you try to do what you planned?",
  "What is one thing you will do before we next meet?",
  "What did you notice about yourself while you were telling me this?",
  "How would you sum this up in one sentence?",
]);

// ── Storytelling: "Tell us about…" ───────────────────────────────────

const STORIES = numbered("story", [
  "Tell us about a time a small change made a big difference.",
  "Tell us about the best team you have been part of. What made it work?",
  "Tell us about a mistake that taught you something you still use.",
  "Tell us about a problem you solved in an unusual way.",
  "Tell us about a time you changed your mind about something at work.",
  "Tell us about someone who taught you a lot, and what you learned.",
  "Tell us about a release or launch you will never forget.",
  "Tell us about a time you asked for help and were glad you did.",
  "Tell us about a decision you would make differently today.",
  "Tell us about a skill from outside work that helps you here.",
  "Tell us about a time a user surprised you.",
  "Tell us about your first week in this team. What stood out?",
  "Tell us about a meeting that went far better than you expected.",
  "Tell us about a time you had to say no, and how you did it.",
  "Tell us about a piece of work you are quietly proud of.",
  "Tell us about a time a plan fell apart, and what happened next.",
  "Tell us about a rule or process you are glad someone dropped.",
  "Tell us about a day when everything just clicked.",
  "Tell us about a time you disagreed with the team and it helped.",
  "Tell us about a trick that saves you time every week.",
  "Tell us about something you learned from a newer colleague.",
  "Tell us about a time you had very little time and still delivered.",
  "Tell us about a question that changed how you saw a problem.",
  "Tell us about a small habit that makes your workday better.",
  "Tell us about the most useful feedback you have had.",
]);

// ── Story splitting: worked examples of the SPIDR patterns ──────────

/** Five examples per pattern, in our own words. Keyed by SPLIT_PATTERNS ids. */
const SPLIT_EXAMPLES: Readonly<Record<SplitPattern["id"], readonly string[]>> = {
  spike: [
    "Not sure the payment provider can refund part of an order? Try its test account for a day, then size the refund stories.",
    "Nobody knows how slow the old search really is: measure it for half a day before splitting “make search faster”.",
    "“Import from the old system”: first a short spike that reads three real files and lists what breaks.",
    "Before “add voice input”, two days to check the browser feature works on the phones your users carry.",
    "“Recommend products” is a guess: a spike on last month's orders shows whether simple rules are enough.",
  ],
  path: [
    "“Checkout”: the happy path with one saved card first. Coupons, failed payments and guest checkout follow.",
    "“Sign up”: email and password first. A work account and invite links become stories of their own.",
    "“Book a room”: one room, one time slot, no clashes first. Repeating bookings come later.",
    "“Return an item”: the main route through the form first. Part returns and swaps are their own stories.",
    "“Upload a file”: a small file that works first. Errors for big files, wrong types and lost connections after.",
  ],
  interface: [
    "“Dashboard”: a plain table of the numbers first. Charts and filters come after.",
    "“Mobile app”: the web page on a phone first. The installed app is a later story.",
    "“Export the report”: a CSV file first. PDF and a shared link follow.",
    "“Search”: one box with plain results first. Advanced filters come later.",
    "“Notifications”: an email first. In-app alerts and phone messages follow.",
  ],
  data: [
    "“Show prices”: one currency first, end to end. The others follow once it works.",
    "“Import contacts”: a CSV from one tool first. Other formats are stories of their own.",
    "“Reports by region”: one region's data first, then the rest.",
    "“Attachments”: images first. Video and documents come later.",
    "“Translate the app”: one language first, with the setup that makes the next ones cheap.",
  ],
  rules: [
    "“Discounts”: one fixed discount first. Stacking rules and limits per customer after.",
    "“Approve expenses”: one approver first. Amounts over a limit going to a second approver next.",
    "“Password rules”: a minimum length first. History and expiry rules as separate stories.",
    "“Shipping costs”: one flat rate first. Rules by weight and distance next.",
    "“Booking limits”: anyone can book first. Limits per person and closed days next.",
  ],
};

const SPLITTING: DeckCard[] = SPLIT_PATTERNS.flatMap((p) =>
  (SPLIT_EXAMPLES[p.id] ?? []).map((text, i) => ({
    id: `split-${p.id}-${i + 1}`,
    title: p.name,
    text,
    hint: p.how,
  }))
);

// ── Yay! questions: appreciation ─────────────────────────────────────

const YAY = numbered("yay", [
  "Who made your week easier, and how?",
  "What did a teammate do this sprint that you would like to thank them for?",
  "Whose idea do you wish you had thought of?",
  "Who helped you learn something new lately?",
  "What does this team do better than any team you have worked in?",
  "Who stepped in when something went wrong?",
  "Which piece of someone else's work are you still thinking about?",
  "Who asked a question that made the work better?",
  "Who kept things calm when it got busy?",
  "What small kindness did you notice this week?",
  "Who shared what they know without being asked?",
  "Whose work would you show off to a friend?",
  "Who made a meeting better just by being in it?",
  "What progress are we not celebrating enough?",
  "Who took on a dull task so others didn't have to?",
  "Who gave you feedback that helped?",
  "What did someone teach the team this sprint?",
  "Who would you like to work with more, and why?",
  "Which user or stakeholder made our day?",
  "What are you thankful for in how we work together?",
  "Who spotted a problem before it got big?",
  "Who brought energy when the team needed it?",
  "What from the last month deserves a cheer?",
  "Who made someone new feel welcome?",
  "Name one strength of the person who speaks after you.",
]);

// ── Check-in and check-out, read from the Ice Breaker ────────────────

/** Ice Breaker activities that open a meeting well: short, a question or a quick share. */
const CHECK_IN_IDS = [
  "q-7",
  "a-2",
  "q-10",
  "a-10",
  "c-2",
  "ag-2",
  "q-3",
  "q-2",
  "q-4",
  "q-6",
  "q-8",
  "q-9",
  "a-1",
  "a-6",
  "a-9",
  "c-5",
  "ag-13",
  "ag-14",
  "ag-15",
] as const;

/** Ice Breaker activities that close one well: a look back, a word, a thank-you. */
const CHECK_OUT_IDS = [
  "q-7",
  "a-7",
  "q-10",
  "c-1",
  "a-2",
  "c-2",
  "c-3",
  "c-9",
  "ag-3",
  "ag-11",
] as const;

const ICEBREAKERS = new Map(icebreakers.map((ib) => [ib.id, ib]));

/**
 * The Ice Breaker activities `ids` names, as cards: their own description and
 * name. A name that `dropTitle` matches is left off: the Check-out deck holds
 * "One Word Check-In", whose words close a meeting as well as they open one,
 * but whose name would put "Check-In" on a closing card.
 */
function fromIcebreakers(ids: readonly string[], dropTitle?: RegExp): DeckCard[] {
  const out: DeckCard[] = [];
  for (const id of ids) {
    const ib = ICEBREAKERS.get(id);
    if (!ib) continue;
    out.push({
      id: `ib-${ib.id}`,
      ...(dropTitle?.test(ib.name) ? {} : { title: ib.name }),
      text: ib.description,
    });
  }
  return out;
}

/** An activity name that says it opens a meeting. */
const OPENER_NAME = /check[\s-]?in\b/i;

// ── The decks ────────────────────────────────────────────────────────

export const DEFAULT_DECK_ID = "retro";

export const BUILT_IN_DECKS: readonly Deck[] = [
  {
    id: "retro",
    name: "Retro prompts",
    blurb: "Questions that open up a retrospective.",
    source: "built-in",
    cards: RETRO,
    keywords: ["retro", "retrospective", "sprint", "improve", "lessons", "reflect", "review"],
  },
  {
    id: "coaching",
    name: "Coaching questions",
    blurb: "Open questions for a one-to-one or a stuck conversation.",
    source: "built-in",
    cards: COACHING,
    keywords: ["coach", "coaching", "one-to-one", "1:1", "mentor", "growth", "question", "career"],
  },
  {
    id: "stories",
    name: "Tell us about…",
    blurb: "Storytelling prompts that help a team get to know each other.",
    source: "built-in",
    cards: STORIES,
    keywords: ["story", "stories", "storytelling", "team building", "know", "experience", "past"],
  },
  {
    id: "splitting",
    name: "Story splitting",
    blurb: "One worked example per card of the five SPIDR splitting patterns.",
    source: "built-in",
    cards: SPLITTING,
    keywords: ["split", "splitting", "refinement", "backlog", "user story", "spidr", "slice"],
  },
  {
    id: "yay",
    name: "Yay! questions",
    blurb: "Appreciation questions: who helped, what went well.",
    source: "built-in",
    cards: YAY,
    keywords: ["yay", "appreciation", "thanks", "kudos", "gratitude", "celebrate", "praise"],
  },
  {
    id: "check-in",
    name: "Check-in",
    blurb: "Openers from the Ice Breaker: a word, a share, a quick question.",
    source: "icebreaker",
    cards: fromIcebreakers(CHECK_IN_IDS),
    keywords: ["check-in", "checkin", "warm up", "opener", "start", "icebreaker", "mood"],
  },
  {
    id: "check-out",
    name: "Check-out",
    blurb: "Closers from the Ice Breaker: a look back before everyone leaves.",
    source: "icebreaker",
    cards: fromIcebreakers(CHECK_OUT_IDS, OPENER_NAME),
    keywords: ["check-out", "checkout", "close", "closing", "end", "wrap up", "goodbye"],
  },
];

const BY_ID = new Map(BUILT_IN_DECKS.map((d) => [d.id, d]));

export const BUILT_IN_DECK_IDS: readonly string[] = BUILT_IN_DECKS.map((d) => d.id);

export function isBuiltInDeckId(id: unknown): boolean {
  return typeof id === "string" && BY_ID.has(id);
}

/** A built-in deck by id, or undefined. */
export function builtInDeck(id: string): Deck | undefined {
  return BY_ID.get(id);
}
