/**
 * Flow Insights' AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { CLASSIFY_REASON_MAX, flowInsightsClassifyTask } from "./flow-insights";

export const flowInsightsClassifyPrompt = defineAiPrompt(flowInsightsClassifyTask, {
  system: [
    "You sort a team's finished work items by the kind of work they were.",
    'For each item give its id and its type: "feature" for new value for the people who use the product, "defect" for fixing something that does not work as it should, "debt" for work that makes future work easier (refactoring, upgrades, clean-up), "risk" for security, compliance or reducing an unknown.',
    'Set "failure" to true when the item is repeat work caused by an earlier failure: a defect, a fix, or an item marked as reopened. Otherwise false.',
    `Give a reason of at most ${CLASSIFY_REASON_MAX} characters in plain words. Use only the ids given, each once. No emoji.`,
  ].join(" "),
  user: ({ items }) =>
    [
      "Finished items:",
      ...items.map((it) => {
        const parts = [`${it.id}: ${it.title}`];
        if (it.text) parts.push(`note: ${it.text}`);
        if (it.tags.length) parts.push(`tags: ${it.tags.join(", ")}`);
        if (it.from) parts.push(`sent from: ${it.from}`);
        if (it.reopened) parts.push("reopened");
        return parts.join(" | ");
      }),
    ].join("\n"),
});
