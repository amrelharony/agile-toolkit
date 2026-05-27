import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";
import { getLastFairnessResult } from "../kudos/llm/fairness";

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

  // Phase 3 — LLM intelligence templates. Both lean on data the fairness +
  // history layers produce; they degrade gracefully when those layers are
  // empty (no AI configured, no recent activity) by referring to the
  // teammates / signals as placeholders.
  const fairness = getLastFairnessResult();
  const topUnderRecognised = fairness
    ? fairness.underRecognised.slice(0, 3).map((u) => u.profileId)
    : [];
  const fairnessRefs =
    topUnderRecognised.length > 0
      ? `\n## Under-recognised teammates (top ${topUnderRecognised.length})\n` +
        topUnderRecognised.map((id) => `- ${sanitizePromptCell(id, 64)}`).join("\n")
      : "";

  const recentImpedimentsResolved = workspace
    ? workspace.impediments
        .filter((i) => {
          if (!i.resolvedAt) return false;
          const t = Date.parse(i.resolvedAt);
          if (!Number.isFinite(t)) return false;
          return Date.now() - t <= 7 * 86_400_000;
        })
        .slice(0, 5)
    : [];
  const recentSprintsCompleted = workspace
    ? workspace.sprints.filter((s) => s.status === "completed").slice(-3)
    : [];
  const winsRefs = (() => {
    if (!workspace) return "";
    if (recentImpedimentsResolved.length === 0 && recentSprintsCompleted.length === 0) {
      return "";
    }
    const lines: string[] = [];
    if (recentImpedimentsResolved.length > 0) {
      lines.push("## Recent impediments resolved (last 7 days)");
      for (const i of recentImpedimentsResolved) {
        lines.push(`- ${sanitizePromptCell(i.title, 120)}`);
      }
    }
    if (recentSprintsCompleted.length > 0) {
      lines.push("## Recently completed sprints");
      for (const s of recentSprintsCompleted) {
        lines.push(
          `- Sprint ${sanitizePromptCell(s.name ?? s.id, 60)} — ${s.pointsCompleted ?? 0}/${s.pointsPlanned ?? 0} pts`
        );
      }
    }
    return "\n" + lines.join("\n");
  })();

  const intelligence: PromptDefinition[] = [
    {
      id: "kudos-under-recognised",
      title: "Recognise the under-recognised",
      description:
        "Draft kudos for teammates who've been shipping work but haven't received many cards lately.",
      prompt:
        buildPreamble(
          "Kudos",
          "Help the user write kudos for teammates flagged as under-recognised by the fairness analyser."
        ) +
        `${context}${fairnessRefs}\n\n## What I want\n\nWrite 3 short kudos messages (25-50 words each) aimed at the under-recognised profile ids above. Each should:\n  • Reference a specific recent contribution if context allows\n  • Sound warm and personal, not corporate\n  • Avoid generic praise ("great job") in favour of named impact\n\nIf no under-recognised teammates were flagged, write 3 generic but specific templates the user can adapt.\n\nReturn just the messages, separated by a blank line.`,
    },
    {
      id: "kudos-this-weeks-wins",
      title: "Celebrate this week's wins",
      description:
        "Draft kudos that reference impediments resolved or sprints completed in the last 7 days.",
      prompt:
        buildPreamble(
          "Kudos",
          "Help the user celebrate concrete wins from the last 7 days — impediments cleared, sprints landed, decisions recorded."
        ) +
        `${context}${winsRefs}\n\n## What I want\n\nWrite 3 short kudos messages (25-50 words each). Each should:\n  • Pull from a real win above (impediment title, sprint completion, etc.)\n  • Name the impact ("this unblocked the team", "shipped on time")\n  • Sound like one human writing to another\n\nReturn just the messages, separated by a blank line.`,
    },
  ];

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

  return [...grounded, ...intelligence, ...generic];
}
