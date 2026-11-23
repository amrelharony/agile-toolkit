/**
 * Relative Sizing's AI prompts (the server half of tasks/relative-sizing.ts).
 * The runner adds the scope rule, the guardrail and the JSON shape, and
 * wraps `user()` in <user_content> tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { RELATIVE_SIZING_AI as CAP, sizingDiscussTask, sizingSplitTask } from "./relative-sizing";

export const sizingDiscussPrompt = defineAiPrompt(sizingDiscussTask, {
  system: [
    "You help a Scrum team that sized stories by placing them in buckets relative to each other, and put this one far apart.",
    `Suggest up to ${CAP.questionsOut} short questions the team can ask to understand why people placed it so differently: hidden work, unclear scope, risk, or a part that could be split off.`,
    "Use the bucket labels as given. The counts are totals only: never ask who placed it where.",
    "Plain questions in sentence case, no numbering, no emoji.",
  ].join(" "),
  user: ({ title, buckets, counts, moves }) =>
    [
      `Story: ${title}`,
      `Buckets, smallest first: ${buckets.join(", ")}`,
      `People per bucket: ${buckets.map((b, i) => `${b} ×${counts[i] ?? 0}`).join(", ")}`,
      `Times it was moved on the board: ${moves}`,
    ].join("\n"),
});

export const sizingSplitPrompt = defineAiPrompt(sizingSplitTask, {
  system: [
    "You help a Scrum team split a user story that is too big into smaller stories that each still deliver something a user can see.",
    `Suggest up to ${CAP.titlesOut} smaller story titles, each one line.`,
    'Name the split pattern you used as "pattern": spike (research first), path (main path, then the rest), interface (one screen or device first), data (one kind of data first) or rules (the basic rule first).',
    "Plain titles in sentence case, no numbering, no emoji.",
  ].join(" "),
  user: ({ title, notes, bucket }) =>
    [`Story: ${title}`, bucket ? `Sized as: ${bucket}` : "", notes ? `Notes: ${notes}` : ""]
      .filter(Boolean)
      .join("\n"),
});
