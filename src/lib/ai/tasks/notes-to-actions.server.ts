/**
 * Notes to Actions' AI task, the server half: the instructions and the
 * pasted notes as data. Server-only, so the prompt never reaches the
 * browser. The runner adds the scope rule, the guardrail and the JSON-shape
 * line, and wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { notesToActionsExtractTask } from "./notes-to-actions";

export const notesToActionsExtractPrompt = defineAiPrompt(notesToActionsExtractTask, {
  system: [
    "You read the notes of a team's meeting and pick out what needs following up.",
    'For each item give its kind: "action" (someone will do something), "decision" (the meeting agreed or chose something), "impediment" (something blocks or slows the team), "story" (work to build on the product), "bug" (something in the product doesn\'t work as it should) or "question" (a question left open).',
    "text is the item in a few plain words. detail is optional extra context from the notes.",
    "owner is the person named in the notes as doing it, spelled exactly as in the notes; leave it out when no one is named.",
    "due is a date in YYYY-MM-DD only when the notes name one, counted from the meeting's date; sprintEnd, when given, is the last day of the running sprint.",
    "quote is the line of the notes the item comes from, copied exactly, at most 200 characters.",
    "Skip lines that need no follow-up. Never invent items, people or dates, never merge two lines into one quote, and never use Markdown.",
  ].join(" "),
  user: ({ notes, meeting, date, sprintEnd }) =>
    [
      `Meeting: ${meeting || "not named"}`,
      `Date: ${date}`,
      ...(sprintEnd ? [`Sprint ends: ${sprintEnd}`] : []),
      "Notes:",
      notes,
    ].join("\n"),
});
