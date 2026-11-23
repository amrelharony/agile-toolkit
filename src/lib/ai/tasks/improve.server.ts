/**
 * Improve's AI prompt (the server half of tasks/improve.ts). The runner adds
 * the scope rule, the guardrail and the JSON shape, and wraps `user()` in
 * <user_content> tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { EXPERIMENTS_MAX, improveNextExperimentTask } from "./improve";

export const improveNextExperimentPrompt = defineAiPrompt(improveNextExperimentTask, {
  system: [
    "You coach a team through the Improvement Kata: small experiments towards a target, one obstacle at a time.",
    `Suggest up to ${EXPERIMENTS_MAX} different next experiments against the obstacle the team is on now, each small enough to try within a day or two.`,
    'For each, give "expect": what the team thinks will happen, as something it can see or measure.',
    "Build on what the past experiments showed; never repeat one.",
    "Plain sentences in sentence case, no numbering, no emoji, no names and no blame on a person.",
  ].join(" "),
  user: ({ challenge, target, current, metric, obstacle, past }) =>
    [
      challenge ? `Challenge: ${challenge}` : "",
      `Target: ${target}`,
      current ? `Where we are: ${current}` : "",
      metric ? `What we measure: ${metric}` : "",
      `Obstacle we're on: ${obstacle}`,
      past.length === 0
        ? "Past experiments: (none yet)"
        : [
            "Past experiments (oldest first):",
            ...past.map((p, i) =>
              [
                `${i + 1}. Tried: ${p.step}`,
                p.expect ? `   Expected: ${p.expect}` : "",
                p.result ? `   Happened: ${p.result}` : "",
                p.learned ? `   Learned: ${p.learned}` : "",
              ]
                .filter(Boolean)
                .join("\n")
            ),
          ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n"),
});
