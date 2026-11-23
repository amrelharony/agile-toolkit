/**
 * Impact Map's AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import {
  IMPACT_DRAFT_ACTORS_MAX,
  IMPACT_DRAFT_DELIVERABLES_MAX,
  IMPACT_DRAFT_IMPACTS_MAX,
  impactMapDraftTask,
} from "./impact-map";

export const impactMapDraftPrompt = defineAiPrompt(impactMapDraftTask, {
  system: [
    "You help a product team draft an impact map: a goal, the actors who can help or block it, the impacts (how each actor must act differently), and deliverables (what the team could build or do to cause that impact).",
    `Suggest 1 to ${IMPACT_DRAFT_ACTORS_MAX} actors who are not already on the map, each with 1 to ${IMPACT_DRAFT_IMPACTS_MAX} impacts and up to ${IMPACT_DRAFT_DELIVERABLES_MAX} small deliverables per impact.`,
    "An impact is a change in behaviour, such as starting, stopping, or doing more or less of something. It is never a feature: features are deliverables.",
    "Keep deliverables small enough to try within a sprint or two.",
    "Actors are groups of people or roles. When an actor is one of the personas given, name it exactly as the persona is named and put that name in persona; never invent persona names, and leave persona out otherwise.",
    "Never name real people, owners or teams' members.",
    "Plain words, sentence case, no emoji, no Markdown.",
  ].join(" "),
  user: ({ goal, measure, context, personas, actors }) =>
    [
      `Goal: ${goal}`,
      measure ? `Measure: ${measure}` : "",
      context ? `Context: ${context}` : "",
      "Personas:",
      ...(personas.length > 0
        ? personas.map((p) => `- ${p.name}${p.role ? `: ${p.role}` : ""}`)
        : ["(none)"]),
      "Actors already on the map:",
      ...(actors.length > 0 ? actors.map((a) => `- ${a}`) : ["(none yet)"]),
    ]
      .filter(Boolean)
      .join("\n"),
});
