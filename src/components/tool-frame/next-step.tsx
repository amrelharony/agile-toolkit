"use client";

import { useMemo } from "react";
import Link from "@/components/motion/transition-link";
import { ArrowRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { getNextStepRule, type NextStep, type NextStepRule } from "@/lib/tools/next-steps";

const NO_SLICES = {};
const noSlices = () => NO_SLICES;

/** The steps a tool's rule gives for the current workspace; [] without a rule. */
export function useNextSteps(toolId: string): NextStep[] {
  const rule: NextStepRule<object> | undefined = getNextStepRule(toolId);
  const slices = useWorkspaceStore(useShallow(rule?.select ?? noSlices));
  return useMemo(() => (rule ? rule.steps(slices) : []), [rule, slices]);
}

/**
 * "Next step" under a tool: the first step its rule gives, as one card
 * with a link. Renders nothing for tools without a rule or when no step
 * applies, and nothing until the workspace has loaded from storage (the
 * server render has an empty workspace, so a step would flash in and out).
 */
export function NextStepCard({ toolId }: { toolId: string }) {
  const hydrated = useWorkspaceHydrated();
  const [step] = useNextSteps(toolId);
  if (!hydrated || !step) return null;

  return (
    <aside
      data-chrome="next-step"
      aria-labelledby={`next-step-${step.id}`}
      className="mt-8 flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Next step</p>
        <h2 id={`next-step-${step.id}`} className="mt-0.5 text-sm font-semibold text-text">
          {step.label}
        </h2>
        {step.detail && <p className="mt-0.5 text-sm text-sub">{step.detail}</p>}
      </div>
      <Link
        href={step.href}
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-accent/40 bg-card px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-center"
      >
        Go<span className="sr-only">: {step.label}</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </aside>
  );
}
