/**
 * OWNER APPROVAL NEEDED
 * ─────────────────────
 * Every word in this file is a DRAFT written from the bible's wants, strengths
 * and overused strengths. Nothing here is the owner's text yet. While
 * WHICH_COLLEAGUE_APPROVED is false the tool stays out of the hub and the catalog,
 * and its address shows book readers "coming soon" with none of this text.
 *
 * To release it, once the owner has approved the wording:
 *   1. Set WHICH_COLLEAGUE_APPROVED to true below.
 *   2. Remove `pendingApproval: true` from which-colleague in
 *      src/lib/constants/tools.ts. That list reaches every browser and this file
 *      must not, so it can't read this flag; test/vip/which-colleague.test.ts
 *      fails until the two agree.
 *
 * The bible's dignity rule decides the wording: "readers should recognise their
 * work and keep their dignity", and the joke targets a habit, not a person. So
 * questions ask about a moment at work, never what someone is like, and a result
 * never reads as a label on anyone.
 *
 * Server-only, so the questions reach a browser only as props on an unlocked,
 * approved page.
 */

import "server-only";
import type { WhichColleagueGame } from "./which-colleague";

export const WHICH_COLLEAGUE_APPROVED = false;

export const WHICH_COLLEAGUE_GAME: WhichColleagueGame = {
  intro:
    "Pass the phone around, or answer together. Pick what's closest to this week, not what you'd like to be true. Nothing is saved or sent anywhere.",
  resultLead: "This week, your answers sit closest to",
  dignityNote:
    "Everyone in the cast is capable, and anyone can pick up any of these habits on a busy day. This is about the habit, not about you.",
  discussion:
    "When has this strength helped our team, and when has it gone too far? What would make it easy to say so at the time?",
  questions: [
    {
      id: "q1",
      prompt: "A new piece of work lands on an already busy day. What matters most to you?",
      answers: [
        {
          id: "a",
          text: "Not letting colleagues or customers down.",
          colleagues: ["Capacity Camel"],
        },
        {
          id: "b",
          text: "Delivering because people are really relying on it.",
          colleagues: ["Deadline Rabbit"],
        },
        {
          id: "c",
          text: "Spending our limited attention on something worth achieving.",
          colleagues: ["Value Falcon"],
        },
        {
          id: "d",
          text: "Keeping things moving today with the time we've got.",
          colleagues: ["Technical Debt Termite"],
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
          text: "This could make the result better, and they'll feel heard.",
          colleagues: ["Scope Creep Cat"],
        },
        {
          id: "b",
          text: "Things have changed, so the request should change too.",
          colleagues: ["Requirement Chameleon"],
        },
        {
          id: "c",
          text: "Let's protect the quality people rely on.",
          colleagues: ["Perfectionist Owl"],
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
          text: "Finding the one decision that's blocking everything else.",
          colleagues: ["Dependency Spider"],
        },
        { id: "c", text: "Giving a direction and taking responsibility.", colleagues: ["HiPPO"] },
        {
          id: "d",
          text: "One short question, asked at the right moment.",
          colleagues: ["Agile Sticky"],
        },
      ],
    },
    {
      id: "q4",
      prompt: "Something has just gone wrong. Where do you start?",
      answers: [
        { id: "a", text: "Getting the service back quickly.", colleagues: ["Firefighter Fox"] },
        {
          id: "b",
          text: "Working out who's accountable, so it doesn't happen again.",
          colleagues: ["Blame Game Wolf"],
        },
        {
          id: "c",
          text: "Understanding what's happening before choosing a next move.",
          colleagues: ["Rubber Duck Analyst"],
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
          colleagues: ["Overengineering Octopus"],
        },
        {
          id: "c",
          text: "A word with whoever remembers the last time we tried this.",
          colleagues: ["Dinosaur"],
        },
        {
          id: "d",
          text: "To find the specific risk inside that vague worry.",
          colleagues: ["Assurance Badger"],
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
          colleagues: ["Data Ghost"],
        },
        {
          id: "b",
          text: "Ask to hear from the people receiving the service.",
          colleagues: ["Customer Voice Parrot"],
        },
        {
          id: "c",
          text: "Help make the assumptions behind it something we can check.",
          colleagues: ["Rubber Duck Analyst"],
        },
        {
          id: "d",
          text: "Ask what evidence would be acceptable, then ask again.",
          colleagues: ["Assurance Badger"],
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
          text: "Making sure no obligation gets missed along the way.",
          colleagues: ["Captain Blocker Ox"],
        },
        {
          id: "c",
          text: "Helping the whole service move through its connections.",
          colleagues: ["Dependency Spider"],
        },
        {
          id: "d",
          text: "Understanding the real problem, so we can choose together.",
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
          text: "Hear it once more, then decide whether the need still exists.",
          colleagues: ["Zombie Backlog"],
        },
        {
          id: "b",
          text: "Remember why it mattered, in case it still does.",
          colleagues: ["Dinosaur"],
        },
        {
          id: "c",
          text: "See if a small repeatable part could be simplified.",
          colleagues: ["Automation Raccoon"],
        },
        { id: "d", text: "Quietly say yes and fit it in.", colleagues: ["Capacity Camel"] },
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
          text: "A calm place for an honest conversation.",
          colleagues: ["Retrospective Turtle"],
        },
        { id: "d", text: "Space for others to say what's going on.", colleagues: ["Amr"] },
      ],
    },
  ],
};
