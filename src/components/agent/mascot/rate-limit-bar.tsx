"use client";

/**
 * Compact agent-usage bar for the mascot panel (Phase 6). Reads the usage
 * snapshot the orchestrator parsed from the stream route's X-RateLimit-*
 * headers. Renders nothing until the first metered turn, and shows the daily
 * window (the tightest cap users hit first); turns red as it approaches the
 * cap or once a 429 marks it limited.
 */

import { useAgentStore } from "@/lib/agent/store";

export function RateLimitBar() {
  const rl = useAgentStore((s) => s.rateLimit);
  if (!rl) return null;

  const pct = rl.dailyMax > 0 ? Math.min(100, Math.round((rl.dailyUsed / rl.dailyMax) * 100)) : 0;
  const danger = rl.limited || pct >= 90;

  return (
    <div className="border-b border-border px-4 pb-2 pt-2" data-testid="rate-limit-bar">
      <div className="mb-1 flex items-center justify-between text-[10px] text-sub">
        <span>Agent usage today</span>
        <span className={danger ? "font-medium text-destructive" : ""}>
          {rl.dailyUsed} / {rl.dailyMax}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            danger ? "bg-destructive" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {rl.limited && (
        <p className="mt-1 text-[10px] text-destructive">
          Daily limit reached — it frees up on a rolling 24-hour window.
        </p>
      )}
    </div>
  );
}
