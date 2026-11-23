/**
 * Kanban's AI task, the server half: the instructions and the user message.
 * The runner adds the scope rule, the guardrail and the JSON shape, and
 * wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { kanbanPoliciesTask, type PoliciesInput } from "./kanban";

const CLASS_NAME: Record<PoliciesInput["classes"][number], string> = {
  standard: "standard",
  expedite: "expedite (jumps the queue)",
  fixed_date: "fixed date",
  intangible: "intangible (no deadline, such as an upgrade)",
};

export const kanbanPoliciesPrompt = defineAiPrompt(kanbanPoliciesTask, {
  system: [
    "You help a team write the explicit policies of its Kanban board, its Definition of Workflow.",
    "For each listed stage (use its id exactly as given, never Done), write when work may enter it and when it may leave it: one short, checkable sentence each, in plain words, under 200 characters.",
    "Respect the WIP limits given; keep what the existing policies already say unless it clashes with the notes.",
    "Also give where work counts as started (startPoint), where it counts as finished (finishPoint, usually meeting the Definition of Done), a blocker policy (what the team does when an item is blocked), and up to three short questions the team should answer next.",
    "Plain text only, no Markdown, no emoji. Never name people.",
  ].join(" "),
  user: (i) => {
    const lines = [
      `Board: ${i.board === "sprint" ? "Sprint board (stories in a sprint)" : "Flow board (cards)"}`,
    ];
    if (i.workItem) lines.push(`One work item: ${i.workItem}`);
    lines.push(
      "Stages:",
      ...i.stages.map(
        (s) => `- ${s.stage} (${s.label}): ${s.wip ? `WIP limit ${s.wip}` : "no WIP limit"}`
      )
    );
    if (i.classes.length) {
      lines.push(`Classes of service in use: ${i.classes.map((c) => CLASS_NAME[c]).join(", ")}`);
    }
    const notes: [string, string | undefined][] = [
      ["What isn't working inside the team", i.notes.inside],
      ["What isn't working for the people served", i.notes.outside],
      ["What comes in", i.notes.demand],
      ["What the team delivers today", i.notes.capability],
    ];
    for (const [label, value] of notes) if (value) lines.push(`${label}: ${value}`);
    if (i.existing.length) {
      lines.push(
        "Existing policies:",
        ...i.existing.map((p) => `- ${p.stage}: enter "${p.enter ?? ""}", exit "${p.exit ?? ""}"`)
      );
    }
    return lines.join("\n");
  },
});
