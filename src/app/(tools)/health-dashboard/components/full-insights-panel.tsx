"use client";

/**
 * The "Active Signals" header band — cross-tool intelligence surfaced by the
 * shared InsightsEngine, shown at the top of the dashboard.
 */

import { Activity } from "lucide-react";
import { InsightsEngine } from "@/components/shared/insights-engine";

export function FullInsightsPanel() {
  return (
    <div className="mb-6 rounded-xl border border-accent/20 bg-accent/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-text">Active Signals</h2>
        <span className="text-xs text-sub">
          &mdash; cross-tool intelligence from your workspace
        </span>
      </div>
      <InsightsEngine limit={6} compact />
    </div>
  );
}
