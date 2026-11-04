/**
 * Which Colleague Are You?: every word here was written from the bible's wants,
 * strengths and overused strengths (Agile_At_Work_Expanded_Canon.json, "cast"),
 * then checked answer by answer against that canon and against its humane humour
 * rules before release on 2026-11-04.
 *
 * To withdraw it:
 *   1. Set WHICH_COLLEAGUE_APPROVED to false below.
 *   2. Put `pendingApproval: true` back on which-colleague in
 *      src/lib/constants/tools.ts. That list reaches every browser and this file
 *      must not, so it can't read this flag; test/vip/which-colleague.test.tsx
 *      fails until the two agree.
 * Withdrawn, the tool leaves the hub and the catalog, and its address shows book
 * readers "coming soon" with none of this text.
 *
 * The bible's dignity rule decides the wording: "readers should recognise their
 * work and keep their dignity", and the joke targets a habit, not a person. So
 * questions ask about a moment at work, never what someone is like, and a result
 * never reads as a label on anyone. No answer is the obviously good one: Amr's
 * two are his habits too, a favourite method and a question for everyone.
 *
 * Every colleague but those in NEVER_A_RESULT sits behind two answers, in two
 * different questions, so each can come up and can win outright. An answer's
 * second name is a colleague whose want or strength in the bible fits the same
 * words. Keep it that way when changing an answer: test/vip/which-colleague.test.tsx
 * plays every combination.
 *
 * Server-only, so the questions reach a browser only as props on an unlocked,
 * approved page.
 */

import "server-only";
import type { WhichColleagueGame } from "./which-colleague";

export const WHICH_COLLEAGUE_APPROVED = true;

/**
 * In no answer, so never read out as a player's result. The bible: "Zombie
 * Backlog represents work that remains unresolved or unexamined. The character
 * is never a diagnosis or an insult applied to a real colleague."
 */
export const NEVER_A_RESULT: readonly string[] = ["Zombie Backlog"];

export const WHICH_COLLEAGUE_GAME: WhichColleagueGame = {
  intro:
    "Pass the phone around, or answer together. Pick what's closest to this week, not what you'd like to be true. Nothing is saved or sent anywhere.",
  resultLead: "This week, your answers sit closest to",
  dignityNote:
    "Everyone in the cast is capable, and anyone can pick up any of these habits on a busy day. Some of the cast are things at work, like a sticky note or a tea glass: they stand for a habit, never a person. This is about the habit, not about you.",
  discussion:
    "When has this strength helped us as a team, and when have any of us taken it too far? What would make it easy to say so at the time?",
  questions: [
    {
      id: "q1",
      prompt: "A new piece of work lands on an already busy day. What matters most to you?",
      answers: [
        {
          id: "a",
          text: "Not letting colleagues or customers down.",
          colleagues: ["Capacity Camel", "Firefighter Fox"],
        },
        {
          id: "b",
          text: "Getting it done by when it's needed.",
          colleagues: ["Deadline Rabbit"],
        },
        {
          id: "c",
          text: "Deciding what deserves our limited attention.",
          colleagues: ["Value Falcon", "HiPPO"],
        },
        {
          id: "d",
          text: "Keeping things moving today with the time we've got.",
          colleagues: ["Technical Debt Termite", "Feature Factory Hamster"],
        },
      ],
    },
    {
      id: "q2",
      prompt:
        "Someone asks for a change to work that's nearly finished. What's your first thought?",
      answers: [
        {
          id: "a",
          text: "This could make it better and more impressive, and they'll feel heard.",
          colleagues: ["Scope Creep Cat", "Vanity Metrics Peacock"],
        },
        {
          id: "b",
          text: "Things have changed, so the request should change too.",
          colleagues: ["Requirement Chameleon"],
        },
        {
          id: "c",
          text: "Let's protect the quality, and be clear what's ours to change.",
          colleagues: ["Perfectionist Owl", "Silo Hedgehog"],
        },
        {
          id: "d",
          text: "Will it still be usable and safe enough for its real purpose?",
          colleagues: ["Dependable Beaver"],
        },
      ],
    },
    {
      id: "q3",
      prompt: "A decision has been stuck for a while. What do you reach for?",
      answers: [
        { id: "a", text: "Getting a useful group together.", colleagues: ["Meeting Monkey"] },
        {
          id: "b",
          text: "Tracing what it's waiting on, and who.",
          colleagues: ["Dependency Spider"],
        },
        {
          id: "c",
          text: "Putting my view on the table, so there's something to react to.",
          colleagues: ["HiPPO"],
        },
        {
          id: "d",
          text: "A small, well-timed nudge, not a speech.",
          colleagues: ["Agile Sticky", "Ahwa Cup"],
        },
      ],
    },
    {
      id: "q4",
      prompt: "Something has just gone wrong. Where do you start?",
      answers: [
        {
          id: "a",
          text: "Getting the service back quickly.",
          colleagues: ["Firefighter Fox", "Deadline Rabbit"],
        },
        {
          id: "b",
          text: "Working out who's accountable, so it doesn't happen again.",
          colleagues: ["Blame Game Wolf"],
        },
        {
          id: "c",
          text: "Understanding what's happening before choosing a next move.",
          colleagues: ["Rubber Duck Analyst", "Data Ghost"],
        },
        {
          id: "d",
          text: "Helping people learn from it, so nobody pays for it twice.",
          colleagues: ["Retrospective Turtle"],
        },
      ],
    },
    {
      id: "q5",
      prompt: "A big plan is on the table. What do you want before anyone commits?",
      answers: [
        { id: "a", text: "A small practical test first.", colleagues: ["Experiment Mouse"] },
        {
          id: "b",
          text: "Something robust, so we aren't caught unprepared later.",
          colleagues: ["Overengineering Octopus", "Dependable Beaver"],
        },
        {
          id: "c",
          text: "A word with whoever remembers the last time we tried this.",
          colleagues: ["Dinosaur"],
        },
        {
          id: "d",
          text: "A clear view of exactly what could go wrong, or get missed.",
          colleagues: ["Assurance Badger", "Captain Blocker Ox"],
        },
      ],
    },
    {
      id: "q6",
      prompt: "Your team has done good work and nobody seems to have noticed. What do you do?",
      answers: [
        {
          id: "a",
          text: "Make the work visible, so it's credited.",
          colleagues: ["Vanity Metrics Peacock"],
        },
        {
          id: "b",
          text: "Show how much we've got done.",
          colleagues: ["Feature Factory Hamster"],
        },
        {
          id: "c",
          text: "Connect the work to the effect it was meant to have.",
          colleagues: ["Value Falcon"],
        },
        {
          id: "d",
          text: "Bring in what the people using it actually said.",
          colleagues: ["Customer Voice Parrot"],
        },
      ],
    },
    {
      id: "q7",
      prompt: "A report looks fine, but something about it bothers you. What do you do?",
      answers: [
        {
          id: "a",
          text: "Point out the gap before someone relies on it.",
          colleagues: ["Data Ghost", "Agile Sticky"],
        },
        {
          id: "b",
          text: "Ask to hear from the people receiving the service.",
          colleagues: ["Customer Voice Parrot", "Scope Creep Cat"],
        },
        {
          id: "c",
          text: "Walk through one real example to see if it holds.",
          colleagues: ["Rubber Duck Analyst"],
        },
        {
          id: "d",
          text: "Ask what evidence would settle it.",
          colleagues: ["Assurance Badger", "Perfectionist Owl"],
        },
      ],
    },
    {
      id: "q8",
      prompt: "Another team asks to get involved in your area. What's on your mind?",
      answers: [
        {
          id: "a",
          text: "Protecting our expertise and what's confidential.",
          colleagues: ["Silo Hedgehog"],
        },
        {
          id: "b",
          text: "Making sure it's clear who's responsible for what.",
          colleagues: ["Captain Blocker Ox", "Blame Game Wolf"],
        },
        {
          id: "c",
          text: "Working out who else this will touch.",
          colleagues: ["Dependency Spider", "Overengineering Octopus"],
        },
        {
          id: "d",
          text: "Suggesting a way of working together that's helped before.",
          colleagues: ["Amr"],
        },
      ],
    },
    {
      id: "q9",
      prompt: "An old request turns up on the list again. What do you do?",
      answers: [
        {
          id: "a",
          text: "Ask what's changed since it was first raised.",
          colleagues: ["Requirement Chameleon"],
        },
        {
          id: "b",
          text: "Keep it until we're sure nobody will miss it.",
          colleagues: ["Dinosaur"],
        },
        {
          id: "c",
          text: "Try simplifying one small, repeatable part of it, as a test.",
          colleagues: ["Automation Raccoon", "Experiment Mouse"],
        },
        {
          id: "d",
          text: "Quietly say yes and fit it in.",
          colleagues: ["Capacity Camel", "Technical Debt Termite"],
        },
      ],
    },
    {
      id: "q10",
      prompt: "The team has been flat out for weeks. What would you most like to offer?",
      answers: [
        {
          id: "a",
          text: "A small shared pause, so the mood gets noticed.",
          colleagues: ["Ahwa Cup"],
        },
        {
          id: "b",
          text: "Some time back, by making ordinary work less tedious.",
          colleagues: ["Automation Raccoon"],
        },
        {
          id: "c",
          text: "A calm look back at what's made it so hard.",
          colleagues: ["Retrospective Turtle"],
        },
        {
          id: "d",
          text: "A question to each person: what would help?",
          colleagues: ["Amr", "Meeting Monkey"],
        },
      ],
    },
  ],
};
