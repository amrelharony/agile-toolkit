/**
 * Release Readiness's AI task, the server half: the instructions and the
 * release's stories as data. Server-only, so the prompt never reaches the
 * browser. The runner adds the scope rule, the guardrail and the JSON-shape
 * line, and wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { releaseReadinessNotesTask } from "./release-readiness";

export const releaseReadinessNotesPrompt = defineAiPrompt(releaseReadinessNotesTask, {
  system: [
    "You write release notes from the stories a software release ships.",
    'audience "customers" means people who use the product: plain benefits, no ticket keys, no internal names. audience "team" means the people who built it: name epics and keys where given.',
    "kind says whether a story is new, a fix or a change; group the notes into up to four sections, such as New, Fixed and Changed.",
    "Each item is one short sentence and lists the ids of the stories it covers, copied exactly as given. Cover every story; never add one that was not given.",
    "headline is one short line; intro is one or two sentences. When rolledBack is true, say plainly that the release was rolled back.",
    "Never invent features, numbers, dates or people, and never use Markdown.",
  ].join(" "),
  user: ({ release, date, audience, rolledBack, stories }) =>
    [
      `Release: ${release}`,
      `Date: ${date}`,
      `Audience: ${audience}`,
      `Rolled back: ${rolledBack ? "yes" : "no"}`,
      ...stories.map(
        (s) =>
          `Story ${s.id} (${s.kind}): ${s.title}${s.epic ? `; epic ${s.epic}` : ""}${
            s.key ? `; key ${s.key}` : ""
          }${s.notes ? `; notes: ${s.notes}` : ""}`
      ),
    ].join("\n"),
});
