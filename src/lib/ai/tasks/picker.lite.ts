/**
 * Picker's AI task, the lite half pages import (no zod; the def, with its
 * schemas, is `picker.ts` and loads on first AI use). Team Mixer reuses it
 * for group names.
 */

import { lazyAiTask } from "../task-ref";
import { fallbackThemeNames } from "@/lib/picker/themes";
import type { ThemeNamesInput, ThemeNamesOutput } from "./picker";
export type { ThemeNamesInput, ThemeNamesOutput } from "./picker";

export const THEME_NAMES_MAX = 20;
export const THEME_NAME_CHARS = 30;
export const THEME_TEXT_CHARS = 60;

/** Names without AI: the built-in themed lists (lib/picker/themes). */
export const themeNamesFallback = ({ theme, count, seed }: ThemeNamesInput): ThemeNamesOutput => ({
  names: fallbackThemeNames(theme, count, seed),
});

export const themeNamesTask = lazyAiTask<ThemeNamesInput, ThemeNamesOutput>(
  { id: "picker.theme_names", toolId: "picker", fallback: themeNamesFallback },
  () => import("./picker").then((m) => m.themeNamesTask)
);
