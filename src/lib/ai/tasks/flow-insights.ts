/**
 * Flow Insights' AI task, the def: sort finished items by the kind of work
 * they were (feature, defect, debt, risk) and say which were repeat work
 * caused by an earlier failure, each with a short reason. The person
 * accepts one or all into the items, with Undo; nothing is written by the
 * answer itself.
 *
 * The page sends short ids ("i1" … "i60") and maps them back, so row ids
 * never leave the browser; cards send no tags. Without AI it answers from
 * the page's own rules, then title words (`classifyFallback` in
 * `flow-insights.lite.ts`, which pages import, with the caps and
 * `fitClassifyInput`). The prompt lives in `flow-insights.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { WORK_TYPES } from "@/lib/stores/workspace-types";
import {
  CLASSIFY_FROM_MAX,
  CLASSIFY_ID_MAX,
  CLASSIFY_ITEMS_MAX,
  CLASSIFY_REASON_MAX,
  CLASSIFY_TAGS_MAX,
  CLASSIFY_TAG_MAX,
  CLASSIFY_TEXT_MAX,
  CLASSIFY_TITLE_MAX,
  classifyFallback,
} from "./flow-insights.lite";

export {
  CLASSIFY_FROM_MAX,
  CLASSIFY_ID_MAX,
  CLASSIFY_ITEMS_MAX,
  CLASSIFY_REASON_MAX,
  CLASSIFY_TAGS_MAX,
  CLASSIFY_TAG_MAX,
  CLASSIFY_TEXT_MAX,
  CLASSIFY_TITLE_MAX,
  classifyFallback,
  cleanClassified,
  fitClassifyInput,
} from "./flow-insights.lite";

const id = z.string().trim().min(1).max(CLASSIFY_ID_MAX);

const input = z.object({
  items: z
    .array(
      z.object({
        id,
        title: z.string().trim().min(1).max(CLASSIFY_TITLE_MAX),
        /** A card's description or the start of a story's notes. */
        text: z.string().trim().max(CLASSIFY_TEXT_MAX).optional(),
        tags: z.array(z.string().trim().min(1).max(CLASSIFY_TAG_MAX)).max(CLASSIFY_TAGS_MAX),
        /** The tool it was sent from (a tool id). */
        from: z.string().trim().max(CLASSIFY_FROM_MAX).optional(),
        reopened: z.boolean(),
      })
    )
    .min(1)
    .max(CLASSIFY_ITEMS_MAX),
});

const output = z.object({
  items: z
    .array(
      z.object({
        id,
        type: z.enum(WORK_TYPES),
        failure: z.boolean(),
        reason: z.string().trim().min(1).max(CLASSIFY_REASON_MAX),
      })
    )
    .max(CLASSIFY_ITEMS_MAX),
});

export type ClassifyInput = z.infer<typeof input>;
export type ClassifyOutput = z.infer<typeof output>;
export type ClassifiedItem = ClassifyOutput["items"][number];

export const flowInsightsClassifyTask = defineAiTask({
  id: "flow-insights.classify",
  toolId: "flow-insights",
  tier: "flash",
  effort: "low",
  maxTokens: 6144,
  input,
  output,
  fallback: classifyFallback,
  sample: {
    items: [
      { id: "i1", title: "Pay with a saved card", tags: ["checkout"], reopened: false },
      { id: "i2", title: "Totals wrong when a voucher is removed", tags: [], reopened: true },
      { id: "i3", title: "Upgrade the payments SDK", tags: [], reopened: false },
      { id: "i4", title: "Spike: fraud checks for new cards", tags: ["spike"], reopened: false },
    ],
  },
});
