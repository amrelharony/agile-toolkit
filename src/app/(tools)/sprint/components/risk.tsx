"use client";

import { useId } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { RISK_LEVEL_LABEL, type SprintRisk } from "@/lib/sprints/risk";
import type { Sprint } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

/**
 * The note ("Why, and what to try") loads when the card first draws it, so
 * the AI kit and the task's schemas stay out of the Cockpit's first load.
 * Its space is held meanwhile, so the card doesn't jump.
 */
const RiskNote = dynamic(() => import("./risk-note").then((m) => m.RiskNote), {
  ssr: false,
  loading: () => <div className="h-9" aria-hidden="true" />,
});

/**
 * The goal check: whether the sprint goal is at risk, the reasons the rule
 * found and a thing to try for each (lib/sprints/risk). "Why, and what to
 * try" asks Amr for a short plain note on top (`RiskNote`, ./risk-note); it
 * is only shown, nothing is saved from it, and without AI the rule's own
 * sentences answer. The note shows only while the facts it was written from
 * still hold. A sprint on track gets one quiet line; one that isn't running
 * gets nothing (the verdict says where it stands).
 */
export function CockpitRisk({
  risk,
  sprint,
  day,
  length,
  compact = false,
  withNote = true,
}: {
  risk: SprintRisk;
  sprint: Pick<Sprint, "id" | "name" | "goal">;
  /** Today's sprint day, for the note. */
  day: number | null;
  /** The sprint's last day. */
  length: number;
  /** The home card: the reasons without the things to try, and no note. */
  compact?: boolean;
  /** Offer the note (not in the read-only example: it reads the team's own sprint). */
  withNote?: boolean;
}) {
  const headingId = useId();
  if (!risk.applies) return null;
  if (risk.level === "none") {
    return (
      <p className="flex items-start gap-2 text-sm text-sub" data-risk="none">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <span>{risk.headline}</span>
      </p>
    );
  }
  const atRisk = risk.level === "at_risk";
  const Icon = atRisk ? AlertTriangle : Eye;
  return (
    <section
      aria-labelledby={headingId}
      data-risk={risk.level}
      className={cn(
        "space-y-3 rounded-lg border p-3 sm:p-4",
        atRisk ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn("mt-0.5 h-4 w-4 shrink-0", atRisk ? "text-destructive" : "text-warning")}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-text">
            Goal check: {RISK_LEVEL_LABEL[risk.level].toLowerCase()}
          </h2>
          <p className="break-words text-sm text-text">{risk.headline}</p>
        </div>
      </div>
      <ul className="space-y-2 text-sm" aria-label="Reasons">
        {risk.reasons.map((r) => (
          <li key={r.id} data-risk-reason={r.id} className="min-w-0 break-words">
            <span
              className={cn(
                "mr-1 font-medium",
                r.level === "at_risk" ? "text-destructive" : "text-warning"
              )}
            >
              {RISK_LEVEL_LABEL[r.level]}:
            </span>
            <span className="text-text">{r.text}</span>
            {!compact && <span className="block text-sub">Try: {r.tryThis}</span>}
          </li>
        ))}
      </ul>
      {!compact && withNote && <RiskNote risk={risk} sprint={sprint} day={day} length={length} />}
    </section>
  );
}
