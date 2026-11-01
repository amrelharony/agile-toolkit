import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { HealthTrafficLight, HealthTrend, Workspace } from "../stores/workspace-types";

/** One rated dimension of the check in progress: a built-in one or one the team added. */
export interface HealthCheckPromptDimension {
  name: string;
  light: HealthTrafficLight;
  /**
   * Against the previous saved check (`trendSince`). Null or absent when
   * there is nothing to compare: no check before ("First check"), or no
   * light for it then ("New since …"), never "same".
   */
  trend?: HealthTrend | null;
  /** A dimension the team added to the built-in eight. */
  custom?: boolean;
  /** What the team said about it. */
  note?: string;
}

interface HealthCheckData {
  current: {
    /** The check's name: its sprint, else the day it is for (`checkLabel`). */
    label: string;
    /** The dimensions rated so far, in page order: a placeholder light is never passed. */
    dimensions: HealthCheckPromptDimension[];
    /** The active dimensions not rated yet. */
    unrated?: string[];
    /** Its health, 0–100, yellow counting half (`sharePct(draftShare)`). */
    healthPct?: number | null;
  };
  /** The saved check the trends are against (`checkLabel`); absent for a first check. */
  previousLabel?: string;
}

const LIGHT: Record<HealthTrafficLight, string> = {
  green: "GREEN",
  yellow: "YELLOW",
  red: "RED",
};
const TREND: Record<HealthTrend, string> = {
  up: "↑ Improving",
  same: "→ Stable",
  down: "↓ Declining",
};

/** A name or note the team typed, on one line. */
const cell = (s: string, max = 60) => sanitizePromptCell(s, max);
const list = (names: string[]) =>
  names.length > 0 ? names.map((n) => cell(n)).join(", ") : "None";

/**
 * Prompts for the Squad Health Check, from the check in progress: the
 * dimensions the team rated (built-in and its own), each light with its
 * trend since the previous saved check as the page derives it.
 */
export function generateHealthCheckPrompts(
  data: HealthCheckData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const dims = data.current.dimensions;
  if (dims.length === 0) return [];

  const prevLabel = data.previousLabel ? cell(data.previousLabel) : null;
  // As the page says it: nothing to compare against is never "stable".
  const trendText = (d: HealthCheckPromptDimension) =>
    d.trend ? TREND[d.trend] : prevLabel ? `New since ${prevLabel}` : "First check";
  const withNotes = dims.some((d) => d.note?.trim());
  const table = formatTable(
    ["Dimension", "Status", "Trend", ...(withNotes ? ["Note"] : [])],
    dims.map((d) => [
      cell(d.name) + (d.custom ? " (team's own)" : ""),
      LIGHT[d.light],
      trendText(d),
      ...(withNotes ? [d.note?.trim() ? cell(d.note, 140) : "—"] : []),
    ])
  );

  const reds = dims.filter((d) => d.light === "red").map((d) => d.name);
  const yellows = dims.filter((d) => d.light === "yellow").map((d) => d.name);
  const declining = dims.filter((d) => d.trend === "down").map((d) => d.name);
  const unrated = data.current.unrated ?? [];
  const own = dims.filter((d) => d.custom).length;
  const health = data.current.healthPct;

  const label = cell(data.current.label, 80);
  const summary =
    `The team rated ${dims.length} ${dims.length === 1 ? "dimension" : "dimensions"}${own > 0 ? ` (${own} of their own)` : ""} using traffic lights (Green/Yellow/Red) for "${label}".` +
    (typeof health === "number" ? ` Health ${health}% (green counts 1, yellow ½, red 0).` : "") +
    (prevLabel
      ? ` Each trend is against the previous saved check, "${prevLabel}".`
      : " This is the team's first saved check, so there are no trends yet.") +
    (unrated.length > 0 ? ` Not rated yet: ${list(unrated)}.` : "");

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  return [
    {
      id: "health-deepdive",
      title: "Team Health Deep Dive",
      description: "Prioritize health dimensions and design targeted interventions.",
      prompt:
        buildPreamble("Team Health Check", summary) +
        `## Current Health Assessment\n\n${table}\n\n🔴 Red dimensions: ${list(reds)}\n🟡 Yellow dimensions: ${list(yellows)}\n📉 Declining dimensions: ${list(declining)}${context}\n\n## Questions\n\n1. Prioritize the health dimensions that need immediate attention. Which should be addressed first and why?\n2. For each red or declining dimension, suggest 2-3 specific interventions.\n3. What root causes might connect multiple unhealthy dimensions?\n4. How can the team leverage their green dimensions to improve weaker areas?\n5. Design a focused 15-minute discussion for the team's next retrospective based on these results.`,
    },
    {
      id: "health-facilitation",
      title: "Health Check Facilitation Guide",
      description:
        "Generate discussion questions and exercises based on the lowest-scoring dimensions.",
      prompt:
        buildPreamble(
          "Team Health Check",
          `${summary} Design facilitation activities based on the health check results.`
        ) +
        `## Current Health Assessment\n\n${table}${context}\n\n## Questions\n\n1. Create 3 powerful discussion questions for each red or yellow dimension.\n2. Design a 10-minute team exercise that addresses the most critical health gap.\n3. What signals should the Scrum Master watch for that indicate these dimensions are improving?\n4. How should the team celebrate or protect their green dimensions from declining?\n5. Draft an improvement experiment the team can try next sprint — state hypothesis, action, and success metric.`,
    },
  ];
}
