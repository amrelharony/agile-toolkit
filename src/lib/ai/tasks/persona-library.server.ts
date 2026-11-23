/**
 * Persona Library's AI task, the server half: the instructions and the
 * notes as data. Server-only, so the prompt never reaches the browser. The
 * runner adds the scope rule, the guardrail and the JSON-shape line, and
 * wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { personaFromNotesTask } from "./persona-library";

const TIER_TEXT = {
  primary: "a main persona: someone the product is built for first",
  secondary: "a secondary persona: someone the product also serves",
  anti: "an anti-persona: someone the product is not for",
} as const;

export const personaFromNotesPrompt = defineAiPrompt(personaFromNotesTask, {
  system: [
    "You help a product team turn their research notes into one persona: a short, made-up portrait of someone they build for.",
    "name is a made-up first name that is not in the names already used. Never use a real person's name, email, phone number, company or any other detail that could identify someone in the notes.",
    "role is what the person does, in a few words.",
    "goals are what they want to get done, pains what gets in their way, behaviours how they work today. Each is a short plain line, and only what the notes support: a short list is better than an invented one.",
    "quote is one line in their voice, paraphrased from the notes, never copied word for word. Leave it out when the notes give nothing to paraphrase.",
    "summary is one or two sentences about them; context is where and when they meet the product. Leave either out when the notes don't say.",
    "tags are up to six one- or two-word topics from the notes.",
    "An anti-persona is who the product is not for: say why it doesn't suit them.",
    "Never use Markdown.",
  ].join(" "),
  user: ({ notes, tier, names }) =>
    [
      `Persona: ${TIER_TEXT[tier]}`,
      `Names already used: ${names.length > 0 ? names.join(", ") : "none"}`,
      "Notes:",
      notes,
    ].join("\n"),
});
