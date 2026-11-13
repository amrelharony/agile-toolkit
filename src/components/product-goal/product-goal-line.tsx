"use client";

/**
 * The active Product Goal as a read-only line, for the pages that plan a
 * sprint against it (Sprint Goal, Sprint Planning) and the team charter.
 * It reads the workspace's goals itself (lib/product-goal/model
 * `activeGoal`, example goals left out), and links to the Product Goal
 * page to write or change it. `children` sit under the line, such as
 * Sprint Goal's "Say which part it serves".
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Goal } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { activeGoal, targetText } from "@/lib/product-goal/model";
import type { ProductGoal } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

/** The active goal (example goals left out), from the workspace. */
export function useActiveProductGoal(): ProductGoal | undefined {
  const goals = useWorkspaceStore((s) => s.productGoals);
  return activeGoal(goals);
}

export function ProductGoalLine({
  goal,
  className,
  children,
}: {
  /** The active goal (`useActiveProductGoal`); undefined when none is active. */
  goal: ProductGoal | undefined;
  className?: string;
  children?: ReactNode;
}) {
  if (!goal) {
    return (
      <p
        className={cn("flex items-start gap-1.5 text-xs text-sub", className)}
        data-field="product-goal"
      >
        <Goal className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          No Product Goal yet.{" "}
          <Link href="/product-goal" className="text-accent hover:underline">
            Write the goal
          </Link>{" "}
          your sprints work towards.
        </span>
      </p>
    );
  }
  const target = targetText(goal.targetDate);
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface/40 px-3 py-2", className)}
      data-field="product-goal"
    >
      <p className="flex items-start gap-1.5 text-sm">
        <Goal className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 break-words">
          <span className="font-medium text-text">Product Goal: </span>
          <span className="text-text">{goal.statement}</span>
          {target && <span className="text-sub"> ({target})</span>}{" "}
          <Link
            href="/product-goal"
            aria-label="Open the Product Goal"
            className="whitespace-nowrap text-xs text-accent hover:underline"
          >
            Open
          </Link>
        </span>
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
