/**
 * Root Cause's AI prompts (the server half of tasks/root-cause.ts). The
 * runner adds the scope rule, the guardrail and the JSON shape, and wraps
 * `user()` in <user_content> tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import {
  LOOP_LINKS_MAX,
  ROOT_CAUSE_SUGGESTIONS_MAX,
  categoriesTask,
  countermeasureTask,
  loopLinksTask,
  nextWhyTask,
} from "./root-cause";

const numbered = (lines: readonly string[]) =>
  lines.length === 0 ? "(none yet)" : lines.map((l, i) => `${i + 1}. ${l}`).join("\n");

export const nextWhyPrompt = defineAiPrompt(nextWhyTask, {
  system: [
    "You help a Scrum team run a blameless 5 Whys.",
    `Given the problem and the answers so far, suggest up to ${ROOT_CAUSE_SUGGESTIONS_MAX} short, different candidate answers to the next "why?": each one a cause of the last answer (or of the problem, when there are no answers yet).`,
    "Point at systems, processes, checks and conditions, never at a person's character or a named person.",
    "Each answer is one plain sentence in sentence case, no numbering, no emoji, a team could check whether it is true.",
  ].join(" "),
  user: ({ problem, whys }) => `Problem: ${problem}\nWhy chain so far:\n${numbered(whys)}`,
});

export const categoriesPrompt = defineAiPrompt(categoriesTask, {
  system: [
    "You sort the causes on a team's fishbone (Ishikawa) diagram.",
    "For each cause that sits under the wrong category, say which of the given categories fits it better.",
    "Use only the category names given, spelled as given. Leave out causes that are already in the right place.",
    "Use each cause's id exactly as given.",
  ].join(" "),
  user: ({ problem, categories, causes }) =>
    [
      `Problem: ${problem}`,
      `Categories: ${categories.join(", ")}`,
      "Causes (id | current category | cause):",
      ...causes.map((c) => `${c.id} | ${c.category || "none"} | ${c.text}`),
    ].join("\n"),
});

export const countermeasurePrompt = defineAiPrompt(countermeasureTask, {
  system: [
    "You help a Scrum team turn a root cause into a countermeasure it can act on in the next sprint or two.",
    `Suggest up to ${ROOT_CAUSE_SUGGESTIONS_MAX} different countermeasures that remove or contain the root cause, each small enough for the team to own.`,
    'For each, give a "check": how the team will know, within a sprint or two, whether it worked.',
    "Plain sentences in sentence case, no numbering, no emoji, no blame on a person.",
  ].join(" "),
  user: ({ problem, rootCause, whys, causes }) =>
    [
      `Problem: ${problem}`,
      `Root cause: ${rootCause}`,
      `Why chain:\n${numbered(whys)}`,
      causes.length > 0 ? `Other causes found:\n${numbered(causes)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
});

export const loopLinksPrompt = defineAiPrompt(loopLinksTask, {
  system: [
    "You help a Scrum team draw a causal loop diagram of a problem: things that go up or down, and arrows from a cause to what it changes.",
    `Given the problem, the things on the diagram (each with an id) and the arrows already drawn, suggest up to ${LOOP_LINKS_MAX} new arrows between the given things.`,
    'polarity is "same" when both move the same way (more of one brings more of the other) and "opposite" when they move opposite ways (more of one brings less of the other).',
    "Set delay to true only when the effect takes noticeable time to show.",
    'Prefer arrows that close a loop back to where it started. For each, "why" is one plain sentence in sentence case that the team could check.',
    "Use only the ids given, exactly as given. Never suggest an arrow already drawn, or one from a thing to itself. Never name or blame a person.",
  ].join(" "),
  user: ({ problem, nodes, links }) => {
    const text = new Map(nodes.map((n) => [n.id, n.text]));
    const drawn =
      links.length === 0
        ? ["Arrows already drawn: (none yet)"]
        : [
            "Arrows already drawn (from id -> to id, sign):",
            ...links.map(
              (l) =>
                `${l.from} -> ${l.to}, ${l.polarity} (${text.get(l.from) ?? "?"} -> ${text.get(l.to) ?? "?"})`
            ),
          ];
    return [
      `Problem: ${problem}`,
      "Things (id | thing):",
      ...nodes.map((n) => `${n.id} | ${n.text}`),
      ...drawn,
    ].join("\n");
  },
});
