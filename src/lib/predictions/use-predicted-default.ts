"use client";

import { useEffect, useMemo, useState } from "react";
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
  // Project a Workspace-shaped snapshot from the spread store.
  //
  // `useShallow` is REQUIRED: returning a fresh object literal from a
  // Zustand selector on every call makes React's `useSyncExternalStore`
  // see a snapshot mismatch on every commit, forcing an infinite re-render
  // loop ("Maximum update depth exceeded"). With useShallow the returned
  // reference is reused as long as the per-slice values are shallow-equal.
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

  // Gate against hydration. Before the Zustand persist middleware finishes
  // rehydrating from localStorage, `workspace` reflects emptyWorkspace —
  // a predictor sampling that "data" would return useless values (e.g.
  // "0 stories observed → suggest velocity 0"). The user then sees the
  // bogus suggestion as the prefilled default for one render before it
  // jumps once hydration completes. Wait for it.
  const [hydrated, setHydrated] = useState<boolean>(
    () => useWorkspaceStore.persist.hasHydrated()
  );
  useEffect(() => {
    if (hydrated) return;
    if (useWorkspaceStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkspaceStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return unsub;
  }, [hydrated]);

  return useMemo(() => {
    if (!hydrated) return { value: fallback, confidence: "none" as const };
    const fn = lookupPredictor(toolId, field);
    if (!fn) return { value: fallback, confidence: "none" as const };
    try {
      return fn({ workspace, history: events }) as PredictResult<T>;
    } catch {
      // A bad predictor must never crash a tool.
      return { value: fallback, confidence: "none" as const };
    }
  }, [toolId, field, workspace, events, fallback, hydrated]);
}
