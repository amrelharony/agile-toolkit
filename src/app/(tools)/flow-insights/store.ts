/**
 * Flow Insights' own record: how the page is set to read, per browser. The
 * numbers themselves are read live from the workspace (stories, sprints,
 * the Flow board, capacity plans, the workflow definition), never copied.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import {
  SPRINT_WINDOWS,
  WEEK_WINDOWS,
  type FlowBoard,
  type SprintWindow,
  type WeekWindow,
} from "@/lib/flow/distribution";

export interface FlowInsightsPrefs {
  /** The board to read; null until picked (the page then picks one). */
  board: FlowBoard | null;
  sprintWindow: SprintWindow;
  weekWindow: WeekWindow;
}

export const DEFAULT_PREFS: FlowInsightsPrefs = { board: null, sprintWindow: 6, weekWindow: 12 };

export const useFlowInsightsPrefs = createPersistedStore<FlowInsightsPrefs>(
  "flow-insights",
  DEFAULT_PREFS
);

/** Prefs as read back: anything that isn't one of the choices reads as the default. */
export function normalizePrefs(raw: unknown): FlowInsightsPrefs {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    board: v.board === "sprint" || v.board === "flow" ? v.board : null,
    sprintWindow: (SPRINT_WINDOWS as readonly unknown[]).includes(v.sprintWindow)
      ? (v.sprintWindow as SprintWindow)
      : DEFAULT_PREFS.sprintWindow,
    weekWindow: (WEEK_WINDOWS as readonly unknown[]).includes(v.weekWindow)
      ? (v.weekWindow as WeekWindow)
      : DEFAULT_PREFS.weekWindow,
  };
}
