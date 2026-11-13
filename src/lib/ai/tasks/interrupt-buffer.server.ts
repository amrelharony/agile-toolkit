/**
 * Interrupt Buffer's AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { INTERRUPT_SIZE_MAX } from "@/lib/sprints/interrupts";
import { interruptClassifyTask } from "./interrupt-buffer";

export const interruptClassifyPrompt = defineAiPrompt(interruptClassifyTask, {
  system: [
    "You sort unplanned work that interrupted a Scrum Team's sprint.",
    'For each numbered title, give its index, its kind ("bug" for something broken, "support" for a customer or colleague who needs help, "request" for new or changed work someone asks for, "incident" for an outage or anything urgent in production, "other" for anything else), and a guessed size in story points from 0 to ' +
      `${INTERRUPT_SIZE_MAX} when the title gives enough to guess (1 a small fix, 3 a day or so, 8 a big piece of work); leave size out otherwise.`,
    "Add a reason of a few words when the kind is not obvious. Plain words, no emoji.",
  ].join(" "),
  user: ({ titles }) => ["Interrupts:", ...titles.map((t, i) => `${i}. ${t}`)].join("\n"),
});
