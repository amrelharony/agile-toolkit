"use client";

import { useId } from "react";
import Link from "@/components/motion/transition-link";
import { ArrowRight, CheckCircle2, CircleHelp, MinusCircle, XCircle } from "lucide-react";
import { GOAL_OUTCOME_LABEL } from "@/lib/sprints/goal-doc";
import type { ReviewFacts } from "@/lib/sprints/review-doc";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import type { Sprint, SprintGoalOutcome } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

const ICON: Record<SprintGoalOutcome["met"], { icon: typeof CheckCircle2; tone: string }> = {
  met: { icon: CheckCircle2, tone: "text-success" },
  partly: { icon: MinusCircle, tone: "text-warning" },
  "not-met": { icon: XCircle, tone: "text-danger" },
};

const LINK =
  "inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded";

/**
 * The sprint's goal and the answer to "Did we meet the sprint goal?", both
 * read from Sprint Goal (the review never keeps a second copy). Without an
 * answer, a link to give it there; in the example, no links leave it.
 */
export function GoalCard({
  sprint,
  facts,
  example,
}: {
  sprint: Sprint;
  facts: ReviewFacts;
  example: boolean;
}) {
  const headingId = useId();
  const outcome = facts.goalOutcome;
  const href = sprintHref("/sprint-goal", sprint.id);
  const { icon: Icon, tone } = outcome ? ICON[outcome.met] : { icon: CircleHelp, tone: "text-sub" };
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-card p-4 text-sm"
    >
      <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wider text-accent">
        Sprint goal
      </h2>
      {facts.goal ? (
        <p className="mt-1 break-words text-base text-text">{facts.goal}</p>
      ) : (
        <p className="mt-1 text-sub">{sprint.name} has no sprint goal.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-text">Did we meet the sprint goal?</span>
        {outcome ? (
          <span className="inline-flex items-center gap-1.5 text-text">
            <Icon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden="true" />
            <span className="font-medium">{GOAL_OUTCOME_LABEL[outcome.met]}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sub">
            <Icon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden="true" />
            {facts.goal ? "Not answered yet" : "No goal to answer for"}
          </span>
        )}
      </div>
      {outcome?.note && <p className="mt-1 break-words text-sub">{outcome.note}</p>}
      {!example && (
        <p className="mt-3">
          <Link href={href} className={LINK}>
            {outcome
              ? "Change the answer in Sprint Goal"
              : facts.goal
                ? "Answer it in Sprint Goal"
                : `Set ${sprint.name}'s goal in Sprint Goal`}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </p>
      )}
    </section>
  );
}
