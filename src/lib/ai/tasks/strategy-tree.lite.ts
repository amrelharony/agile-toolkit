/**
 * Strategy Tree's AI task, the lite half the page imports (no zod; the def,
 * with its schemas, is `strategy-tree.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { levelHas, type TreeFormat } from "@/lib/strategy-map/formats";
import type { DraftedBranch, TreeDraftInput, TreeDraftOutput } from "./strategy-tree";
export type { DraftedBranch, TreeDraftInput, TreeDraftOutput } from "./strategy-tree";

/** The input's caps. */
export const TREE_DRAFT_TEXT_MAX = 200;
export const TREE_DRAFT_CONTEXT_MAX = 2000;
export const TREE_DRAFT_EXISTING_MAX = 20;
/** The output's caps: at most 4 × (1 + 3 × (1 + 3)) = 52 parts, all under the root. */
export const TREE_DRAFT_BRANCHES_MAX = 4;
export const TREE_DRAFT_CHILDREN_MAX = 3;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** "[An outcome that moves: <root>]", with the root cut so the bracket fits its cap. */
function about(lead: string, root: string): string {
  const clean =
    root
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "") || "the root";
  // "[", ": " and "]" around the lead and the root.
  const room = TREE_DRAFT_TEXT_MAX - lead.length - 4;
  return `[${lead}: ${cut(clean, room)}]`;
}

/** Each shape's bracket templates: two at level 1, two at level 2, one at level 3. */
const TEMPLATES: Readonly<
  Record<TreeFormat, { one: [string, string]; two: [string, string]; three: string }>
> = {
  dibb: {
    one: ["An insight from", "[A second insight the same data gives you]"],
    two: ["[A belief this insight gives you]", "[Another belief worth testing]"],
    three: "[A small bet to test the belief]",
  },
  "lean-value-tree": {
    one: ["An outcome that moves", "[A second outcome that shows you're getting there]"],
    two: ["[A guess about what will move this goal]", "[Another bet worth trying]"],
    three: "[A piece of work that tests the bet]",
  },
  hoshin: {
    one: ["What must be true this year for", "[A second objective for this year]"],
    two: ["[Where the team puts its effort]", "[A second priority for the year]"],
    three: "[The number you'll check each month]",
  },
};

const MEASURE = "[How you'll measure it]";

/**
 * Branches without AI: two at the first level under the root (the first
 * naming the root), two under each, and one under each of those, as
 * bracket templates to rewrite in the team's own terms, with a measure
 * placeholder where the shape asks for one. Owners are never drafted.
 */
export function fallbackStrategyBranches({ format, root }: TreeDraftInput): TreeDraftOutput {
  const t = TEMPLATES[format];
  if (!t) throw new Error(`No templates for ${String(format)}.`);
  const withMeasure = (level: number, text: string) => ({
    text,
    ...(levelHas(format, level, "measure") ? { measure: MEASURE } : {}),
  });
  const leaf = () => withMeasure(3, t.three);
  const middle = (text: string) => ({ ...withMeasure(2, text), children: [leaf()] });
  return {
    branches: [about(t.one[0], root), t.one[1]].map((text) => ({
      ...withMeasure(1, text),
      children: t.two.map(middle),
    })),
  };
}

export const strategyTreeDraftTask = lazyAiTask<TreeDraftInput, TreeDraftOutput>(
  { id: "strategy-tree.draft", toolId: "strategy-tree", fallback: fallbackStrategyBranches },
  () => import("./strategy-tree").then((m) => m.strategyTreeDraftTask)
);

/** The parts a drafted branch holds, itself included. */
export function branchSize(b: DraftedBranch): number {
  return 1 + b.children.reduce((n, c) => n + 1 + c.children.length, 0);
}
