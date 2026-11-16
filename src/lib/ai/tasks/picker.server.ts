/**
 * The server half of Picker's task: the instructions and the user message.
 * Server-only, so the prompt never reaches the browser. The runner adds the
 * scope rule, the guardrail and the JSON-shape line, and wraps `user()` in
 * `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { THEME_NAME_CHARS, themeNamesTask } from "./picker";

export const themeNamesPrompt = defineAiPrompt(themeNamesTask, {
  system: [
    "You suggest names for an agile team, a sprint or a breakout group, on a theme the person gives.",
    "Give exactly the number of names asked for, all different, each one to three words and at most",
    `${THEME_NAME_CHARS} characters.`,
    "Use well-known things that fit the theme: places, natural features, objects, ideas, or famous figures from history.",
    "Never use the names of living people, brands, or anything rude, political or religious.",
    "Plain words, no numbering, no emoji, no explanations.",
  ].join(" "),
  user: ({ theme, count }) => `Theme: ${theme}\nHow many names: ${count}`,
});
