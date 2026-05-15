"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useHistoryStore } from "../history/history-store";
import type { Workspace } from "../stores/workspace-types";
import { lookupPredictor, type PredictResult } from "./registry";

/**
 * React hook for smart defaults. Looks up the predictor registered for
 * `(toolId, field)`, runs it against the current workspace + history, and
 * returns a PredictResult. If no predictor is registered, returns the
 * fallback with confidence "none".
 *
 * The hook is cheap (memoized on the workspace + history references); the
 * predictor itself is responsible for any heavy work and should use
 * `useDerived` internally if it crosses the cost threshold.
 */
export function usePredictedDefault<T>(toolId: string, field: string, fallback: T): PredictResult<T> {
  // Project a Workspace-shaped snapshot from the spread store. MUST use
  // useShallow — without it, each render's selector returns a fresh object
  // literal that fails Object.is against the previous render's snapshot,
  // and `useSyncExternalStore` (which Zustand sits on) interprets that
  // as a state change and re-renders, causing an infinite render loop.
  const workspace = useWorkspaceStore(
    useShallow((s): Workspace => ({
      teamMembers: s.teamMembers,
      sprints: s.sprints,
      stories: s.stories,
      impediments: s.impediments,
      risks: s.risks,
      okrs: s.okrs,
      decisions: s.decisions,
      techDebt: s.techDebt,
      maturityLevel: s.maturityLevel,
      teamName: s.teamName,
    }))
  );
  const events = useHistoryStore((s) => s.events);

  return useMemo(() => {
    const fn = lookupPredictor(toolId, field);
    if (!fn) return { value: fallback, confidence: "none" as const };
    try {
      return fn({ workspace, history: events }) as PredictResult<T>;
    } catch {
      // A bad predictor must never crash a tool.
      return { value: fallback, confidence: "none" as const };
    }
  }, [toolId, field, workspace, events, fallback]);
}
