/**
 * Flow Insights' data-aware next steps (lib/tools/next-steps.ts calls
 * `flowInsightsSteps`). Both point elsewhere, from the latest finished
 * sprint; example rows are ignored:
 *   - "flow-insights-failure": 30% or more of the latest finished sprint's
 *     items (5 or more) were repeat work → Root Cause;
 *   - "flow-insights-team-change": someone joined or left in the latest
 *     finished sprint → the Release Planner's forecast.
 * Pure: no store, no React, no "use client" module.
 */

import type { CapacityPlan, KanbanBoard, Sprint, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { mixByPeriod } from "./distribution";
import { teamStability } from "./stability";

/** What the rule reads from the workspace. */
export interface FlowInsightsStepsInput {
  stories: readonly Story[];
  sprints: readonly Sprint[];
  boards: readonly KanbanBoard[] | undefined;
  plans: readonly CapacityPlan[] | undefined;
}

/** The latest finished sprint needs this many finished items before its repeat work is called. */
export const FAILURE_STEP_MIN_ITEMS = 5;
/** Repeat work at this share of a sprint's finished items or more is worth finding the cause of. */
export const FAILURE_STEP_SHARE = 0.3;

/** Flow Insights' next steps. */
export function flowInsightsSteps(s: FlowInsightsStepsInput): NextStep[] {
  const stories = Array.isArray(s.stories) ? s.stories : [];
  const sprints = Array.isArray(s.sprints) ? s.sprints : [];
  const out: NextStep[] = [];
  const periods = mixByPeriod({ board: "sprint", stories, sprints, cards: [] });
  const latest = periods[periods.length - 1];
  if (
    latest &&
    latest.finished >= FAILURE_STEP_MIN_ITEMS &&
    latest.failure / latest.finished >= FAILURE_STEP_SHARE
  ) {
    out.push({
      id: "flow-insights-failure",
      label: "Find the cause of the repeat work with Root Cause",
      detail: `${latest.failure} of ${latest.finished} items finished in ${latest.label} fixed or redid earlier work.`,
      href: "/root-cause",
    });
  }
  const rows = teamStability(sprints, s.plans, stories).rows;
  const last = rows[rows.length - 1];
  if (last && (last.joined.length > 0 || last.left.length > 0)) {
    const who = [
      last.joined.length
        ? `${last.joined.length} ${last.joined.length === 1 ? "person" : "people"} joined`
        : "",
      last.left.length ? `${last.left.length} left` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    out.push({
      id: "flow-insights-team-change",
      label: "Check the release forecast after the team change",
      detail: `${who} in ${last.name}. Forecasts lean on the sprints before it.`,
      href: "/release-planner",
    });
  }
  return out;
}
