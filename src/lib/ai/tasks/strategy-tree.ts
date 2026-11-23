/**
 * Strategy Tree's AI task, the def: draft branches under a tree's root in
 * its shape (DIBB, Lean Value Tree, Hoshin Kanri), three levels deep. The
 * person accepts a branch at a time, or all of them, with Undo; nothing is
 * saved before, and owners are never drafted. The fallback and the caps
 * live in `strategy-tree.lite.ts`, which the page imports. The prompt lives
 * in `strategy-tree.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { TREE_FORMATS } from "@/lib/strategy-map/formats";
import {
  TREE_DRAFT_BRANCHES_MAX,
  TREE_DRAFT_CHILDREN_MAX,
  TREE_DRAFT_CONTEXT_MAX,
  TREE_DRAFT_EXISTING_MAX,
  TREE_DRAFT_TEXT_MAX,
  fallbackStrategyBranches,
} from "./strategy-tree.lite";

export {
  TREE_DRAFT_BRANCHES_MAX,
  TREE_DRAFT_CHILDREN_MAX,
  branchSize,
  fallbackStrategyBranches,
} from "./strategy-tree.lite";

const text = (max: number) => z.string().trim().max(max);
const filled = (max: number) => z.string().trim().min(1).max(max);

const input = z.object({
  format: z.enum(TREE_FORMATS),
  /** The root's text. */
  root: filled(TREE_DRAFT_TEXT_MAX),
  /** The root's measure, where its shape has one. */
  measure: text(TREE_DRAFT_TEXT_MAX).optional(),
  /** "Anything Amr should know" (not saved). */
  context: text(TREE_DRAFT_CONTEXT_MAX),
  /** The parts already at the first level, so a draft doesn't repeat them. */
  existing: z.array(filled(TREE_DRAFT_TEXT_MAX)).max(TREE_DRAFT_EXISTING_MAX),
});

const part = { text: filled(TREE_DRAFT_TEXT_MAX), measure: text(TREE_DRAFT_TEXT_MAX).optional() };

const output = z.object({
  branches: z
    .array(
      z.object({
        ...part,
        children: z
          .array(
            z.object({
              ...part,
              children: z.array(z.object(part)).max(TREE_DRAFT_CHILDREN_MAX),
            })
          )
          .max(TREE_DRAFT_CHILDREN_MAX),
      })
    )
    .min(1)
    .max(TREE_DRAFT_BRANCHES_MAX),
});

export type TreeDraftInput = z.infer<typeof input>;
export type TreeDraftOutput = z.infer<typeof output>;
export type DraftedBranch = TreeDraftOutput["branches"][number];

export const strategyTreeDraftTask = defineAiTask({
  id: "strategy-tree.draft",
  toolId: "strategy-tree",
  tier: "full",
  effort: "high",
  maxTokens: 8192,
  input,
  output,
  fallback: fallbackStrategyBranches,
  sample: {
    format: "lean-value-tree",
    root: "Good dinners without the planning",
    context: "A meal-kit service; most customers order once and stop.",
    existing: [],
  },
});
