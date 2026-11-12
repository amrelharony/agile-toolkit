"use client";

/**
 * The Surprise plan's activities on the board it started: the opening
 * while people write, the closing once the board reaches Actions. Dismiss
 * drops the plan for this browser.
 */

import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoardPhase } from "../types";
import { clearPlan, useShownPlan } from "../plan-store";

export function RetroPlanNote({ formatId, phase }: { formatId: string; phase: BoardPhase }) {
  const plan = useShownPlan(formatId);
  if (!plan || (phase !== "write" && phase !== "actions")) return null;
  const activity = phase === "write" ? plan.opening : plan.closing;
  return (
    <aside
      aria-label={phase === "write" ? "Opening activity" : "Closing activity"}
      className="flex items-start gap-2 rounded-lg border border-accent/40 bg-card px-3 py-2"
    >
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-text">
          <span className="font-semibold">{phase === "write" ? "Open with" : "Close with"}:</span>{" "}
          {activity.name} <span className="text-xs text-sub">· {activity.minutes} min</span>
        </p>
        <p className="text-xs text-sub">{activity.line}</p>
        {phase === "write" && plan.why && <p className="mt-1 text-xs text-sub">{plan.why}</p>}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0 text-sub"
        aria-label="Dismiss the retro plan"
        onClick={clearPlan}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </aside>
  );
}
