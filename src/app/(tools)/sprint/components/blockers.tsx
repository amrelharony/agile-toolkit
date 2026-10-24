"use client";

import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import type { Impediment, Story } from "@/lib/stores/workspace-types";
import {
  IMPEDIMENT_SEVERITY_LABEL,
  daysOverdue,
  impedimentAgeDays,
  impedimentStatus,
} from "@/lib/impediments/model";
import { cn } from "@/lib/utils";

const SEVERITY_CLASS: Record<Impediment["severity"], string> = {
  critical: "border-danger/40 bg-danger/10 text-danger",
  high: "border-warning/40 bg-warning/10 text-warning",
  medium: "border-border text-text",
  low: "border-border text-sub",
};

const FLAG = "inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium";

const SHOWN = 4;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Raised today", "Open 3 days", or nothing for an impediment with a bad date. */
function ageLine(imp: Impediment, today: string): string {
  const age = impedimentAgeDays(imp, today);
  if (age === null) return "";
  return age === 0 ? "Raised today" : `Open ${plural(age, "day")}`;
}

/**
 * What is in the sprint's way: its open impediments (escalated, then
 * overdue, worst and oldest first) with their age and flags, and the
 * stories flagged as blocked on the board, each with the way to where it
 * is dealt with.
 */
export function Blockers({
  open,
  resolved,
  blockedStories,
  today,
  boardHref,
}: {
  /** Unresolved impediments in the sprint's window, in order. */
  open: readonly Impediment[];
  /** How many were resolved during the sprint. */
  resolved: number;
  blockedStories: readonly Story[];
  today: string;
  /** The sprint board, for the blocked stories. */
  boardHref: string;
}) {
  const shown = open.slice(0, SHOWN);
  const nothing = open.length === 0 && blockedStories.length === 0;
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
      {nothing ? (
        <p className="text-sm text-sub">
          Nothing is blocking the team. Blockers raised in the standup, sent from a retro or flagged
          on the sprint board land here.
        </p>
      ) : (
        <div className="space-y-4">
          {shown.length > 0 && (
            <ul aria-label="Open impediments" className="divide-y divide-border">
              {shown.map((imp) => {
                const escalated = impedimentStatus(imp) === "escalated";
                const late = daysOverdue(imp, today);
                const meta = [ageLine(imp, today), imp.owner ?? ""].filter(Boolean).join(" · ");
                return (
                  <li key={imp.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                    <span className={cn("mt-0.5", FLAG, SEVERITY_CLASS[imp.severity])}>
                      {IMPEDIMENT_SEVERITY_LABEL[imp.severity] ?? imp.severity}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm text-text">{imp.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-sub">
                        {meta && <span>{meta}</span>}
                        {escalated && (
                          <span className={cn(FLAG, "border-warning/40 text-warning")}>
                            Escalated
                          </span>
                        )}
                        {late > 0 && (
                          <span className={cn(FLAG, "border-danger/40 text-danger")}>
                            {plural(late, "day")} overdue
                          </span>
                        )}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {blockedStories.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-sub">
                Blocked on the board
              </h3>
              <ul aria-label="Blocked stories" className="space-y-1">
                {blockedStories.map((s) => (
                  <li key={s.id} className="break-words text-sm text-text">
                    {s.title}
                    {s.owner ? <span className="text-sub"> · {s.owner}</span> : null}
                  </li>
                ))}
              </ul>
              <Link
                href={boardHref}
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                Unblock them on the board
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      )}
      {resolved > 0 && (
        <p className="mt-3 text-xs text-sub">
          {plural(resolved, "impediment")} resolved during this sprint.
        </p>
      )}
    </SectionCard>
  );
}
