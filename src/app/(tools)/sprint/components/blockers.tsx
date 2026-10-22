"use client";

import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import type { Impediment } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { impedimentAgeDays } from "../view";

const SEVERITY_CLASS: Record<Impediment["severity"], string> = {
  critical: "border-danger/40 bg-danger/10 text-danger",
  high: "border-warning/40 bg-warning/10 text-warning",
  medium: "border-border text-text",
  low: "border-border text-sub",
};

const SEVERITY_LABEL: Record<Impediment["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SHOWN = 4;

/** The worst open impediments, with their age, and the way to the full list. */
export function Blockers({ open, today }: { open: readonly Impediment[]; today: string }) {
  const shown = open.slice(0, SHOWN);
  return (
    <SectionCard
      title="Open blockers"
      icon={ShieldAlert}
      actions={
        <Link
          href="/impediments"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          {open.length > SHOWN ? `All ${open.length}` : "Impediments"}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-sub">
          Nothing is blocking the team. Blockers raised in the standup or sent from a retro land
          here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((imp) => {
            const age = impedimentAgeDays(imp, today);
            return (
              <li key={imp.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <span
                  className={cn(
                    "mt-0.5 inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium",
                    SEVERITY_CLASS[imp.severity]
                  )}
                >
                  {SEVERITY_LABEL[imp.severity]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm text-text">{imp.title}</span>
                  <span className="block text-xs text-sub">
                    {age === 0 ? "Raised today" : `Open ${age} ${age === 1 ? "day" : "days"}`}
                    {imp.owner ? ` · ${imp.owner}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
