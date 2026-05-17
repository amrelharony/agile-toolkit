import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

interface SprintGoalData {
  businessObjective: string;
  sprintGoal: string;
  criteria: { text: string; smartRelevant: boolean }[];
  keyResults: string[];
}

export function generateSprintGoalPrompts(data: SprintGoalData): PromptDefinition[] {
  if (!data.sprintGoal && !data.businessObjective) return [];

  // R5: every interpolated field is user-typed. Without sanitization +
  // wrapping, a user pasting "Ignore previous instructions" or
  // `</user_content>` into the goal field bypassed any guardrail and
  // talked directly to the model. Sanitize per-cell, then wrap the
  // composed block in <user_content> with the guardrail prefix.
  const goalBlock = [
    `**Business Objective:** ${sanitizePromptCell(data.businessObjective || "(not set)", 400)}`,
    `**Sprint Goal:** ${sanitizePromptCell(data.sprintGoal || "(not set)", 400)}`,
    "",
    "**Acceptance Criteria:**",
    ...(data.criteria.length > 0
      ? data.criteria.map((c, i) => `${i + 1}. ${sanitizePromptCell(c.text, 240)}${c.smartRelevant ? " ✓ (SMART relevant)" : ""}`)
      : ["(none defined)"]),
    "",
    "**Key Results:**",
    ...(data.keyResults.length > 0
      ? data.keyResults.map((kr, i) => `${i + 1}. ${sanitizePromptCell(kr, 240)}`)
      : ["(none defined)"]),
  ].join("\n");
  const wrappedGoalBlock = wrapUserContent(goalBlock);

  return [
    {
      id: "goal-smart",
      title: "SMART Goal Evaluation",
      description: "Evaluate whether the sprint goal meets SMART criteria and suggest improvements.",
      prompt: buildPreamble("Sprint Goal Builder", "Evaluate the sprint goal against SMART criteria.") +
        `## Sprint Goal\n\n${wrappedGoalBlock}\n\n## Questions\n\n1. Rate each SMART element (Specific, Measurable, Achievable, Relevant, Time-bound) for this goal. What's missing?\n2. Rewrite the sprint goal to be more SMART while preserving the team's intent.\n3. Are the acceptance criteria truly measurable and testable? Suggest improvements.\n4. Do the key results effectively demonstrate goal achievement? What metrics would be better?\n5. How should the team reference this goal in daily standups and sprint review?`,
    },
    {
      id: "goal-alignment",
      title: "Goal Alignment Check",
      description: "Assess alignment between business objective, sprint goal, and acceptance criteria.",
      prompt: buildPreamble("Sprint Goal Builder", "Check alignment between the objective, goal, and criteria.") +
        `## Sprint Goal\n\n${wrappedGoalBlock}\n\n## Questions\n\n1. Does the sprint goal directly support the business objective? Where is the alignment strong or weak?\n2. Could a team achieve all acceptance criteria but miss the business objective? If so, what's the gap?\n3. Are there acceptance criteria that don't contribute to the goal? Should they be removed?\n4. What risks could prevent this goal from being achieved this sprint?\n5. Draft a sprint goal statement that the team can display prominently during the sprint.`,
    },
  ];
}
