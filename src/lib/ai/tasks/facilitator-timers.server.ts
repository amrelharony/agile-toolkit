/**
 * The server half of Facilitator Timers' agenda task: the instructions and
 * the user message. Server-only, so the prompt never reaches the browser.
 * The runner adds the scope rule, the guardrail and the JSON-shape line, and
 * wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { AGENDA_MAX_SEGMENTS, agendaTask } from "./facilitator-timers";

export const agendaPrompt = defineAiPrompt(agendaTask, {
  system: [
    "You draft a timed agenda for an agile team's meeting or workshop.",
    `Given the meeting's goal and its total length in minutes, return a short title and 2 to ${AGENDA_MAX_SEGMENTS} segments in the order they happen.`,
    "Each segment has a label of a few words, its minutes, and a one-sentence hint saying what happens in it.",
    "The minutes must add up to the total. Open with a short check-in or framing, and close with agreed next steps or a check-out.",
    "Use whole minutes where you can. Plain words, sentence case, no numbering, no emoji, no names of people.",
  ].join(" "),
  user: ({ goal, minutes }) => `Meeting goal: ${goal}\nTotal minutes: ${minutes}`,
});
