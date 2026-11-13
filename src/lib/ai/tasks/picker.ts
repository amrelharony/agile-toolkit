/**
 * Picker's AI task: themed name ideas for a team, a sprint or a group
 * ("rivers", "space missions", "jazz musicians"). Team Mixer reuses it for
 * fun group names. Plain names only, never anything about the people.
 *
 * This half is browser-safe: schemas with hard caps, the fallback (the
 * built-in themed lists, lib/picker/themes) and a sample. The prompt is in
 * `picker.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { fallbackThemeNames } from "@/lib/picker/themes";

export const THEME_NAMES_MAX = 20;
export const THEME_NAME_CHARS = 30;
export const THEME_TEXT_CHARS = 60;

const input = z.object({
  /** What the names are about, in the person's words. */
  theme: z.string().trim().min(2).max(THEME_TEXT_CHARS),
  /** How many names to suggest. */
  count: z.number().int().min(1).max(THEME_NAMES_MAX),
  /** Varies the no-AI draw; the model never sees it. */
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
});

const output = z.object({
  names: z.array(z.string().trim().min(1).max(THEME_NAME_CHARS)).min(1).max(THEME_NAMES_MAX),
});

export const themeNamesTask = defineAiTask({
  id: "picker.theme_names",
  toolId: "picker",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: ({ theme, count, seed }) => ({ names: fallbackThemeNames(theme, count, seed) }),
  sample: { theme: "Rivers of the world", count: 8 },
});
