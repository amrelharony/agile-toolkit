import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

/**
 * Suggested kudos message templates.
 *
 * Owner-mode prompts pull from workspace context — recent impediments
 * resolved, key results hit, sprint goals committed — so the
 * suggestions reference real events ("Thanks for closing impediment X")
 * rather than generic platitudes. Guest-mode (when no workspace is
 * available) gets only the generic templates.
 */
export function generateKudosPrompts(workspace?: Workspace | null): PromptDefinition[] {
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  // Workspace-grounded suggestions when we have context to mine.
  const grounded: PromptDefinition[] = workspace
    ? [
        {
          id: "kudos-impediment-clear",
          title: "Thank a teammate for clearing an impediment",
          description:
            "Suggest 3 short kudos messages that thank a teammate for resolving a recent impediment, referencing it by title.",
          prompt:
            buildPreamble(
              "Kudos",
              "Help the user write a short, specific thank-you for a teammate who recently resolved an impediment."
            ) +
            `${context}\n\n## What I want\n\nWrite 3 short kudos messages (each 1–2 sentences, 25–50 words). Each should:\n  • Mention the impediment by title or topic\n  • Acknowledge the specific contribution\n  • End with a forward-looking note (e.g. "this unblocks the team for next sprint")\n\nReturn just the three messages, separated by a blank line.`,
        },
        {
          id: "kudos-okr-progress",
          title: "Celebrate hitting a Key Result",
          description:
            "Generate 3 congratulatory kudos messages referencing a recently completed Key Result.",
          prompt:
            buildPreamble(
              "Kudos",
              "Help the user celebrate a teammate's contribution to hitting a Key Result."
            ) +
            `${context}\n\n## What I want\n\nWrite 3 short congratulatory kudos messages (1–2 sentences each, 25–50 words). Pick a recent KR from the OKR list. Each should:\n  • Reference the specific KR\n  • Name the impact (numbers if you have them)\n  • Sound warm, not corporate\n\nReturn just the three messages.`,
        },
        {
          id: "kudos-sprint-goal",
          title: "Recognise a sprint goal landing",
          description:
            "Write a kudos for a teammate who pushed the active sprint goal across the line.",
          prompt:
            buildPreamble(
              "Kudos",
              "Help the user recognise a teammate's contribution to the active sprint goal."
            ) +
            `${context}\n\n## What I want\n\nWrite 3 short kudos messages (25–50 words each). Reference the active sprint goal and the teammate's specific role. Keep it warm and specific — avoid "great job overall".`,
        },
      ]
    : [];

  // Generic templates — always available, used as guest-mode fallback.
  const generic: PromptDefinition[] = [
    {
      id: "kudos-pr-review",
      title: "Thanks for a great PR review",
      description:
        "Short, warm kudos thanking a reviewer who caught a subtle bug or improved a design.",
      prompt:
        buildPreamble("Kudos", "Help me write a thank-you for a great pull-request review.") +
        `\n## What I want\n\nWrite 3 short kudos messages (1–2 sentences, 25–50 words). Each should:\n  • Name the bug or design issue they caught (use a placeholder if I haven't given specifics)\n  • Acknowledge the time + care\n  • Avoid clichés ("legend!", "you rock!" outside the card's theme are fine for the message body but don't lean on them)\n\nReturn just the messages.`,
    },
    {
      id: "kudos-handoff",
      title: "Smooth handoff thanks",
      description:
        "Recognise a teammate who set you up for success by leaving great docs / context.",
      prompt:
        buildPreamble("Kudos", "Help me thank a teammate for an unusually clean handoff.") +
        `\n## What I want\n\nWrite 3 short kudos (25–50 words each) thanking someone for clear docs / a well-structured handoff. Specifically reference: notes left, runbook quality, or anticipating an edge case. Keep it conversational.`,
    },
    {
      id: "kudos-unblocked",
      title: "Unblocked me — thank you",
      description:
        "Recognise a teammate who paused their own work to help you past a wall (debugging, an env issue, a quirky tool).",
      prompt:
        buildPreamble("Kudos", "Help me thank a teammate who stopped to help me past a blocker.") +
        `\n## What I want\n\n3 short kudos (25–50 words each). Each:\n  • Names the kind of blocker (debugging, env, dependency, etc.)\n  • Says what their help unlocked (e.g. "shipped my PR by EOD")\n  • Reads like one human writing to another, not a performance review.`,
    },
  ];

  return [...grounded, ...generic];
}
