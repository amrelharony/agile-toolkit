"use client";

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, TrendingUp, Activity, Sparkles, X } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { insightsForTool, topInsights, type Insight } from "@/lib/analytics/insights";
import type { Workspace } from "@/lib/stores/workspace-types";
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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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

  const all = useMemo(
    () => (toolId ? insightsForTool(workspace, toolId, 100) : topInsights(workspace, 100)),
    [workspace, toolId]
  );

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
            className={cn(
              "rounded-lg border p-3 flex items-start gap-3",
              colorFor(ins.severity)
            )}
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
              className="text-sub hover:text-text transition shrink-0"
              onClick={() => setDismissed((s) => new Set(s).add(ins.id))}
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
