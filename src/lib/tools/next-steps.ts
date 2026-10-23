/**
 * Data-aware next steps: where a tool's result should go next.
 *
 * "More in <section>" under every tool is positional — the next four tools
 * in the list, whatever is on the page. A next step reads the workspace and
 * points somewhere that matters now ("3 stories unsized → Planning Poker").
 * `<NextStepCard>` (components/tool-frame/next-step) renders the first one
 * that applies above the related-tools list; a tool can also render
 * `<NextStepCard>` inline next to its result.
 *
 * Each rule picks the workspace slices it needs (`select`, compared
 * shallowly, so it must return store values — not arrays built on the fly)
 * and turns them into steps, most useful first. Tools join as their phase
 * of the tool upgrade lands (plan: tool UX contract, item 8).
 */

import type { Workspace } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";

export interface NextStep {
  /** Stable id, for keys and tests. */
  id: string;
  /** What to do, imperative: "Compare across methods". */
  label: string;
  /** Why now, from the data: "4 ICE ideas are on the backlog." */
  detail?: string;
  href: string;
}

export interface NextStepRule<S extends object> {
  select: (ws: Workspace) => S;
  steps: (slices: S) => NextStep[];
}

const rule = <S extends object>(r: NextStepRule<S>) => r as unknown as NextStepRule<object>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const RULES: Record<string, NextStepRule<object>> = {
  "ice-score": rule({
    select: (ws) => ({ rows: ws.prioritizations }),
    steps: ({ rows }) => {
      const ideas = (rows ?? []).filter((r) => r.framework === "ice" && !isExampleId(r.id));
      const linked = ideas.filter((r) => r.backlogItemId);
      const steps: NextStep[] = [];
      if (linked.length > 0) {
        steps.push({
          id: "ice-compare",
          label: "Compare across methods",
          detail: `${plural(linked.length, "ICE idea")} ${linked.length === 1 ? "is" : "are"} on the backlog. See how ${linked.length === 1 ? "it ranks" : "they rank"} under RICE, WSJF and MoSCoW.`,
          href: "/prioritizer",
        });
      }
      if (ideas.length >= 3) {
        steps.push({
          id: "ice-rice",
          label: "Check the front-runners with RICE",
          detail:
            "ICE is a quick filter. Put the top few on the backlog and score them with RICE's reach and effort before committing.",
          href: "/rice-scoring",
        });
      }
      return steps;
    },
  }),
};

export function getNextStepRule(toolId: string): NextStepRule<object> | undefined {
  return RULES[toolId];
}

/** Tool ids that declare next steps (the UX contract test checks upgraded tools are here). */
export function toolsWithNextSteps(): string[] {
  return Object.keys(RULES);
}
