"use client";

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, TrendingUp, Activity, Sparkles, X } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { insightsForTool, topInsights, type Insight } from "@/lib/analytics/insights";
import type { Workspace } from "@/lib/stores/workspace-types";
import { usePersisted } from "@/lib/utils/use-persisted";
import { cn } from "@/lib/utils";

interface InsightsEngineProps {
  toolId?: string;
  limit?: number;
  compact?: boolean;
}

function iconFor(kind: Insight["kind"]) {
  if (kind === "anti-pattern") return AlertTriangle;
  if (kind === "forecast") return TrendingUp;
  if (kind === "anomaly") return Activity;
  return Sparkles;
}

function colorFor(severity: Insight["severity"]): string {
  if (severity === "critical") return "border-danger/40 bg-danger/5 text-danger";
  if (severity === "warn") return "border-amber-500/40 bg-amber-500/5 text-amber-300";
  return "border-accent/30 bg-accent/5 text-accent";
}

export function InsightsEngine({ toolId, limit = 3, compact = false }: InsightsEngineProps) {
  const [mounted, setMounted] = useState(false);
  // Persist as a string[] (Set isn't JSON-serialisable) keyed per-tool so a
  // dismissal on /burndown doesn't carry over to /retro. A user who dismisses
  // an insight expects it to stay dismissed across page reloads — without
  // persistence, every refresh re-floods the banner with stale alerts.
  const [dismissedArr, setDismissedArr] = usePersisted<string[]>(
    `agile-toolkit:insights:dismissed:${toolId ?? "_global"}`,
    []
  );
  const dismissed = useMemo(() => new Set(dismissedArr), [dismissedArr]);

  useEffect(() => {
    // rehydrate() can return Promise<void> on async storages; wait for it
    // before mounting so the first render reads the persisted workspace,
    // not the empty default. Otherwise users see a "no insights" flash
    // followed by a re-render once the store hydrates.
    let cancelled = false;
    void Promise.resolve(useWorkspaceStore.persist.rehydrate()).then(() => {
      if (!cancelled) setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
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
        // Phase 19+ entities — included so anti-pattern rules that read
        // workspace.llmEvals / .hallucinations / .prioritizations / .daciDecisions
        // / etc. see the actual data instead of an undefined slot (which threw
        // on `.filter()` and crashed the entire insights panel via ErrorBoundary).
        llmEvals: s.llmEvals,
        prompts: s.prompts,
        hallucinations: s.hallucinations,
        tokenSpend: s.tokenSpend,
        models: s.models,
        redTeamFindings: s.redTeamFindings,
        agentWorkflows: s.agentWorkflows,
        agentNodes: s.agentNodes,
        hitlReviews: s.hitlReviews,
        rlhfPairs: s.rlhfPairs,
        vectorCollections: s.vectorCollections,
        modelCards: s.modelCards,
        prioritizations: s.prioritizations,
        daciDecisions: s.daciDecisions,
        rapidDecisions: s.rapidDecisions,
        weightedOptions: s.weightedOptions,
        weightedCriteria: s.weightedCriteria,
        sixHatsThoughts: s.sixHatsThoughts,
        oodaCycles: s.oodaCycles,
        cynefinItems: s.cynefinItems,
        staceyItems: s.staceyItems,
        polarities: s.polarities,
        polarityPoles: s.polarityPoles,
        whiteboards: s.whiteboards,
        whiteboardObjects: s.whiteboardObjects,
        whiteboardCommentThreads: s.whiteboardCommentThreads,
        whiteboardGroups: s.whiteboardGroups,
        whiteboardSavedTemplates: s.whiteboardSavedTemplates,
        whiteboardActivityLog: s.whiteboardActivityLog,
      })
    )
  );

  const all = useMemo(
    () => (toolId ? insightsForTool(workspace, toolId, 100) : topInsights(workspace, 100)),
    [workspace, toolId]
  );

  // Garbage-collect dismissed IDs that no longer appear in the active set —
  // otherwise dismissed entries pile up forever in localStorage as new
  // insights take their slots. We only prune when we know the live set is
  // non-empty (otherwise a temporary "no data" gap would wipe everything).
  useEffect(() => {
    if (!mounted) return;
    if (all.length === 0) return;
    const live = new Set(all.map((i) => i.id));
    const stale = dismissedArr.filter((id) => !live.has(id));
    if (stale.length > 0 && dismissedArr.length - stale.length >= 0) {
      const next = dismissedArr.filter((id) => live.has(id));
      if (next.length !== dismissedArr.length) setDismissedArr(next);
    }
    // dismissedArr / setDismissedArr intentionally omitted — we want to GC
    // when the live set transitions, not on every dismiss action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, all]);

  if (!mounted) return null;

  const visible = all.filter((i) => !dismissed.has(i.id)).slice(0, limit);
  if (visible.length === 0) return null;

  return (
    <div className={cn("space-y-2", compact ? "" : "mb-6")}>
      {visible.map((ins) => {
        const Icon = iconFor(ins.kind);
        return (
          <div
            key={ins.id}
            className={cn("rounded-lg border p-3 flex items-start gap-3", colorFor(ins.severity))}
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{ins.title}</div>
              <div className="text-xs mt-1 whitespace-pre-line opacity-90 text-text/80">
                {ins.body}
              </div>
            </div>
            <button
              type="button"
              className="min-touch-coarse text-sub hover:text-text transition shrink-0 inline-flex items-center justify-center -m-1 p-1 rounded"
              onClick={() =>
                setDismissedArr((arr) => (arr.includes(ins.id) ? arr : [...arr, ins.id]))
              }
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
