"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { SMART_KEYS, SMART_LABELS, type SmartResult } from "./smart";

/** Each check's tooltip: [when it passes, how to make it pass]. */
export type SmartTips = Record<keyof SmartResult, readonly [string, string]>;

export const CRITERION_TIPS: SmartTips = {
  specific: [
    "Names concrete things, no vague words",
    "Avoid vague words like improve, better, good",
  ],
  measurable: [
    "Contains a number or a quantity",
    "Add a number, a percentage or a measurable metric",
  ],
  achievable: ["Good length: not too vague or complex", "Aim for 20–300 characters for clarity"],
  relevant: ["Confirmed relevant by you", "Tick the box to confirm it serves the goal"],
  timeBound: ["Contains a time reference", "Add a deadline like “by end of sprint” or a date"],
};

export const GOAL_TIPS: SmartTips = {
  ...CRITERION_TIPS,
  measurable: [
    "Contains a number or a quantity",
    "Say how much: a number, a percentage, “in one tap”",
  ],
  achievable: ["Short enough to remember", "Aim for one sentence of 20–300 characters"],
  relevant: [
    "Serves the business objective or a linked OKR",
    "Write the business objective or link an OKR",
  ],
  timeBound: ["Bound by its sprint or a date", "Choose a sprint, or say by when"],
};

function SmartBadge({
  label,
  passes,
  tooltip,
}: {
  label: string;
  passes: boolean;
  tooltip: string;
}) {
  return (
    <Badge
      title={tooltip}
      className={
        passes
          ? "bg-accent-green/15 text-accent-green border-accent-green/30 hover:bg-accent-green/25"
          : "bg-danger/15 text-danger border-danger/30 hover:bg-danger/25"
      }
    >
      {label}
      <span className="sr-only">{passes ? " (met)" : " (not met)"}</span>
    </Badge>
  );
}

/**
 * The five SMART badges for one sentence. `relevantControl` sits next to
 * the Relevant badge (a criterion's "relevant" tick).
 */
export function SmartBadges({
  result,
  tips,
  relevantControl,
}: {
  result: SmartResult;
  tips: SmartTips;
  relevantControl?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-sub">SMART:</span>
      {SMART_KEYS.map((key) => {
        const badge = (
          <SmartBadge
            key={key}
            label={SMART_LABELS[key]}
            passes={result[key]}
            tooltip={tips[key][result[key] ? 0 : 1]}
          />
        );
        if (key !== "relevant" || !relevantControl) return badge;
        return (
          <span key={key} className="flex items-center gap-1.5">
            {badge}
            {relevantControl}
          </span>
        );
      })}
    </div>
  );
}
