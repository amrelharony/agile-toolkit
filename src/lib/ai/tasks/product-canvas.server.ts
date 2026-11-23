/**
 * Product Canvas's AI tasks, the server half: the instructions and the user
 * messages. Each format's boxes (their ids, labels and prompts) come from
 * the catalog here, through the sectioned kit's `sectionListText`, so the
 * browser sends only a format id and never a prompt. The runner adds the
 * scope rule, the guardrail and the JSON shape, and wraps `user()` in
 * `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { SECTIONED_RULES, sectionListText } from "./_sectioned.server";
import { CANVAS_ITEMS_MAX, productFormat } from "@/lib/product-canvas/formats";
import {
  DRAFT_OUT_FIELDS_MAX,
  DRAFT_OUT_ITEMS_MAX,
  GAPS_OUT_MAX,
  productCanvasDraftTask,
  productCanvasGapsTask,
} from "./product-canvas";

/** The format's name and its boxes, from the catalog. */
function formatBlock(formatId: string): string[] {
  const format = productFormat(formatId);
  if (!format) return [`Format: ${formatId}`];
  return [
    `Format: ${format.name}`,
    "Its boxes (id: label (what it holds). what to write):",
    sectionListText(format),
  ];
}

const listed = (label: string, items: readonly string[], none = "(none yet)") => [
  `${label}:`,
  ...(items.length > 0 ? items.map((t) => `- ${t}`) : [none]),
];

export const productCanvasDraftPrompt = defineAiPrompt(productCanvasDraftTask, {
  system: [
    "You help a product team fill in a product canvas: one page that describes a product idea in the format they chose.",
    "From the Product Goal, the product vision, the team's short brief, the backlog's story titles and what the canvas already holds, suggest words for its boxes.",
    `Put lines for list boxes in items, with section set to the box id, up to ${DRAFT_OUT_ITEMS_MAX} lines in all and never more than the box holds.`,
    `Put text for one-line and paragraph boxes in fields, with id set to the box id, at most ${DRAFT_OUT_FIELDS_MAX}.`,
    "For a box that lists questions, the line is the question and detail is a short suggested answer; leave detail out everywhere else.",
    "Suggest only lines the canvas doesn't hold yet. A box that already holds text may get a better wording in fields: the team decides whether to use it.",
    "Every line you write is a guess for the team to check, so never present one as proven.",
    "Leave the launch date out: only the team sets it.",
    `A canvas holds ${CANVAS_ITEMS_MAX} lines at most.`,
    ...SECTIONED_RULES,
  ].join(" "),
  user: ({ format, title, goal, vision, brief, fields, sections, stories }) =>
    [
      ...formatBlock(format),
      "",
      `Canvas name: ${title || "(none)"}`,
      `Product Goal: ${goal?.statement || "(not written yet)"}`,
      ...(goal?.why ? [`Why it matters: ${goal.why}`] : []),
      ...(goal && goal.measures.length > 0 ? listed("Its measures", goal.measures) : []),
      `Product vision: ${vision || "(not written yet)"}`,
      `Brief from the team: ${brief || "(none)"}`,
      "",
      "What the canvas holds now:",
      ...(fields.length === 0 && sections.length === 0 ? ["(nothing yet)"] : []),
      ...fields.map((f) => `${f.id}: ${f.text}`),
      ...sections.flatMap((s) => listed(s.id, s.items)),
      "",
      ...listed("Backlog story titles", stories),
    ].join("\n"),
});

export const productCanvasGapsPrompt = defineAiPrompt(productCanvasGapsTask, {
  system: [
    "You review a product team's canvas, one page that describes a product idea, for what is missing or weak.",
    "Look for boxes left empty, lines still holding a [placeholder], guesses nobody has tested, claims with no number, a vision that names features instead of a change for people, vague or buzzword language, offer lines that meet no customer pain or gain, hypotheses with no test, and anything that doesn't serve the Product Goal.",
    "On an idea from the inbox, ask how the team would know it worked and whether it repeats an idea already there. On a business case, ask for early signs, the smallest version to test it and what that version costs. On a Shape Up pitch, ask for its appetite, its rabbit holes and its no-gos, and when its cycle has ended, say it is out of time: ship what's done or cut it.",
    `Answer with up to ${GAPS_OUT_MAX} gaps, the most useful first. Write each as one short question or prompt the team can answer, under 200 characters.`,
    "Set section to the id of the box a gap is about, or leave it out for the canvas as a whole.",
    "Each line in the input says whether it is a fact or a guess, whether it is linked to the line that completes it, and whether it is settled (a question answered, a guess tested, a hypothesis sent to be tested).",
    ...SECTIONED_RULES,
  ].join(" "),
  user: ({ format, title, goal, today, appetiteWeeks, cycleEnded, similar, fields, sections }) =>
    [
      ...formatBlock(format),
      "",
      `Canvas name: ${title || "(none)"}`,
      `Product Goal: ${goal?.statement || "(not written yet)"}`,
      ...(goal?.why ? [`Why it matters: ${goal.why}`] : []),
      ...(today ? [`Today: ${today}`] : []),
      ...(format === "shape-up"
        ? [
            appetiteWeeks !== undefined
              ? `Appetite: ${appetiteWeeks} ${appetiteWeeks === 1 ? "week" : "weeks"}`
              : "Appetite: not set",
          ]
        : []),
      ...(cycleEnded ? [`Its cycle ended on ${cycleEnded}, and it is still bet on.`] : []),
      ...(similar && similar.length > 0
        ? listed("Ideas in the inbox that look like it", similar)
        : []),
      "",
      "What the canvas holds:",
      ...(fields.length === 0 && sections.length === 0 ? ["(nothing yet)"] : []),
      ...fields.map((f) => `${f.id}: ${f.text}`),
      ...sections.flatMap((s) => [
        `${s.id}:`,
        ...s.items.map((l) => {
          const marks = [
            l.evidence === "fact" ? "fact" : l.evidence === "assumption" ? "guess" : "",
            l.linked ? "linked" : "not linked",
            l.answered ? "settled" : "",
            l.asks ? `asks ${l.asks}` : "",
          ].filter(Boolean);
          return `- ${l.text} (${marks.join(", ")})`;
        }),
      ]),
    ].join("\n"),
});
