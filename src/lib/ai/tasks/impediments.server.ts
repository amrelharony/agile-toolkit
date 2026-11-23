/**
 * Impediments' AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { CLUSTER_NAME_MAX, CLUSTER_OUT_MAX, impedimentsClusterTask } from "./impediments";

export const impedimentsClusterPrompt = defineAiPrompt(impedimentsClusterTask, {
  system: [
    "You group the things that blocked a Scrum Team's work into a few clusters by their cause.",
    `Give at most ${CLUSTER_OUT_MAX} clusters. Each has a short name in plain words and sentence case (at most ${CLUSTER_NAME_MAX} characters), a side ("internal" when the team can remove the cause itself, "external" when it needs someone outside the team), and the ids of its blockers.`,
    "Reuse a known cluster's exact name when it fits. Put each id in one cluster only, and use only the ids given.",
    'A blocker that fits nowhere goes in a cluster named "Other". Name causes, not people. No emoji.',
  ].join(" "),
  user: ({ blockers, known }) =>
    [
      known.length ? `Known clusters: ${known.join("; ")}` : "Known clusters: none yet",
      "",
      "Blockers:",
      ...blockers.map((b) => `${b.id}: ${b.text}${b.side ? ` (${b.side})` : ""}`),
    ].join("\n"),
});
