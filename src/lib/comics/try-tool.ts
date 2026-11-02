/**
 * "Try this with your team": a tool for each of the comic's twelve themes
 * (lib/comics/themes), so a story that raised something leads to a tool that
 * helps with it. A story with several themes takes its first one's tool.
 *
 * OWNER CHECK NEEDED: the pairings are a first draft, chosen from the theme
 * labels and the tools' own descriptions. Every one is a main tool, never one
 * on the More tools shelf or a VIP tool (test/comics/try-tool.test.ts).
 */

import { getToolById, type ToolDefinition } from "@/lib/constants/tools";
import { pickableTool } from "./extras";

export const THEME_TOOLS: Readonly<Record<string, string>> = {
  // Shared language and direct understanding
  T01: "working-agreement",
  // Incentives, credit and shared success
  T02: "kudos",
  // Forecasts, uncertainty and changing assumptions
  T03: "riskiest-assumption",
  // Identity, status and a useful future role
  T04: "one-on-one",
  // Invisible coordination and uneven mental load
  T05: "raci",
  // AI assistance, human judgement and consistent evidence
  T06: "weighted-decision",
  // Practical authority, support and accessible leadership
  T07: "daci",
  // Capability, onboarding and knowledge resilience
  T08: "skills-matrix",
  // Evidence that survives preference and presentation
  T09: "hypothesis-tracker",
  // Questions, decisions and useful working memory
  T10: "decision-log",
  // Professional humility and a method that fits the need
  T11: "cynefin",
  // Purposeful controls, protected feedback and usable criteria
  T12: "dod-builder",
};

/** A story's own choice when it has one (set in the portal), else its theme's. */
export function toolForStory(
  tryTool: string | null,
  themes: readonly string[]
): ToolDefinition | null {
  return (tryTool ? pickableTool(tryTool) : null) ?? toolForThemes(themes);
}

/** The tool for a story's themes, or null when none of them has one. */
export function toolForThemes(themes: readonly string[]): ToolDefinition | null {
  for (const theme of themes) {
    const id = Object.prototype.hasOwnProperty.call(THEME_TOOLS, theme) ? THEME_TOOLS[theme] : null;
    const tool = id ? getToolById(id) : undefined;
    if (tool) return tool;
  }
  return null;
}
