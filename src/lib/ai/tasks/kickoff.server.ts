/**
 * Kickoff's AI task, the server half: the instructions and the user
 * message. The format's sections (their ids, labels and prompts) come from
 * the catalog here, through the sectioned kit's `sectionListText`, so the
 * browser sends only a format id and never a prompt. The runner adds the
 * scope rule, the guardrail and the JSON shape, and wraps `user()` in
 * `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { SECTIONED_RULES, sectionListText } from "./_sectioned.server";
import { kickoffFormat } from "@/lib/kickoff/formats";
import { draftFormatOf } from "@/lib/kickoff/model";
import {
  KICKOFF_DRAFT_ITEMS_MAX,
  KICKOFF_DRAFT_SLIDERS_OUT_MAX,
  kickoffDraftTask,
} from "./kickoff";

/** The format's name and its sections, from the catalog (never the team's people). */
function formatBlock(formatId: string): string[] {
  const format = kickoffFormat(formatId);
  if (!format) return [`Format: ${formatId}`];
  return [
    `Format: ${format.name}`,
    "Its sections (id: label (what it holds). what to write):",
    sectionListText(draftFormatOf(format)),
    ...(format.hasSliders
      ? ["It also orders trade-off sliders, from what holds firm to what gives first."]
      : []),
  ];
}

const listed = (label: string, items: readonly string[], none = "(none yet)") => [
  `${label}:`,
  ...(items.length > 0 ? items.map((t) => `- ${t}`) : [none]),
];

export const kickoffDraftPrompt = defineAiPrompt(kickoffDraftTask, {
  system: [
    "You help a team start a new piece of work, or a new team, on the same page: a kickoff in the format they chose.",
    "From the kickoff's name, the team's short brief, the Product Goal and the product vision, suggest lines for its sections.",
    `Put each line in items, with section set to the section id, up to ${KICKOFF_DRAFT_ITEMS_MAX} lines in all and never more than a section holds. A section that holds one answer gets one line at most.`,
    "Suggest only lines the kickoff doesn't hold yet.",
    "Where a line is a guess, say so with the word maybe.",
    `If the format orders trade-off sliders, you may add up to ${KICKOFF_DRAFT_SLIDERS_OUT_MAX} more things that could give way in sliders, each a few words, none already on the list. Leave sliders out for any other format.`,
    "Never name people or say who owns a line: the team picks owners itself.",
    ...SECTIONED_RULES,
  ].join(" "),
  user: ({ format, title, brief, goal, vision, existing, sliders }) =>
    [
      ...formatBlock(format),
      "",
      `Kickoff name: ${title}`,
      `Brief from the team: ${brief || "(none)"}`,
      `Product Goal: ${goal || "(not written yet)"}`,
      `Product vision: ${vision || "(not written yet)"}`,
      "",
      ...listed("What the kickoff holds now", existing, "(nothing yet)"),
      ...(sliders ? ["", ...listed("Trade-offs on the list", sliders)] : []),
    ].join("\n"),
});
