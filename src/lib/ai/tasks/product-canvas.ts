/**
 * Product Canvas's AI tasks, the defs: draft lines for a canvas's boxes,
 * and point out what it still lacks. The person accepts what they want;
 * accepted lines go through the canvas's own writes, with Undo, and a box
 * that holds text is only replaced one at a time. The fallbacks, the caps
 * and the input builders live in `product-canvas.lite.ts`, which pages
 * import. The prompts live in `product-canvas.server.ts`.
 *
 * Only the formats this build offers can be drafted or checked: the
 * inputs refuse any other format id. The gaps input also carries what an
 * idea's, a business case's and a Shape Up pitch's rules read beside the
 * boxes: the appetite, the day a cycle ended, and the titles of ideas that
 * look alike (never who asked, never the demand or a bet's cycle).
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { BUILT_FORMATS } from "@/lib/product-canvas/formats";
import { WEEKS_MAX } from "@/lib/product-canvas/fields";
import {
  DRAFT_BRIEF_MAX,
  DRAFT_FIELDS_MAX,
  DRAFT_FIELD_MAX,
  DRAFT_GOAL_TEXT_MAX,
  DRAFT_ID_MAX,
  DRAFT_LINE_MAX,
  DRAFT_MEASURES_MAX,
  DRAFT_MEASURE_MAX,
  DRAFT_OUT_DETAIL_MAX,
  DRAFT_OUT_FIELDS_MAX,
  DRAFT_OUT_FIELD_MAX,
  DRAFT_OUT_ITEMS_MAX,
  DRAFT_OUT_TEXT_MAX,
  DRAFT_SECTIONS_MAX,
  DRAFT_SECTION_LINES_MAX,
  DRAFT_STORIES_MAX,
  DRAFT_STORY_MAX,
  DRAFT_TITLE_MAX,
  DRAFT_VISION_MAX,
  type CanvasDraftInput,
  type CanvasDraftOutput,
} from "@/lib/product-canvas/starter";
import { PRODUCT_CANVAS_EVIDENCE, type ProductCanvasFormat } from "@/lib/stores/workspace-types";
import {
  GAPS_FIELDS_MAX,
  GAPS_FIELD_MAX,
  GAPS_GOAL_TEXT_MAX,
  GAPS_ID_MAX,
  GAPS_LINE_MAX,
  GAPS_OUT_MAX,
  GAPS_OUT_TEXT_MAX,
  GAPS_SECTIONS_MAX,
  GAPS_SECTION_LINES_MAX,
  GAPS_SIMILAR_MAX,
  GAPS_SIMILAR_TEXT_MAX,
  GAPS_TITLE_MAX,
  GAPS_TODAY_MAX,
  productCanvasDraftFallback,
  productCanvasGapsFallback,
  type CanvasGapsInput,
  type CanvasGapsOutput,
} from "./product-canvas.lite";

export { DRAFT_OUT_FIELDS_MAX, DRAFT_OUT_ITEMS_MAX } from "@/lib/product-canvas/starter";
export {
  GAPS_OUT_MAX,
  draftInputFor,
  fitDraftInput,
  fitGapsInput,
  gapsInputFor,
  productCanvasDraftFallback,
  productCanvasGapsFallback,
} from "./product-canvas.lite";
export type { CanvasDraftInput, CanvasDraftOutput, CanvasGapsInput, CanvasGapsOutput };

const Format = z.enum(BUILT_FORMATS as unknown as [ProductCanvasFormat, ...ProductCanvasFormat[]]);
const Id = z.string().max(DRAFT_ID_MAX);

const draftInput = z.object({
  format: Format,
  title: z.string().max(DRAFT_TITLE_MAX),
  goal: z
    .object({
      statement: z.string().max(DRAFT_GOAL_TEXT_MAX),
      why: z.string().max(DRAFT_GOAL_TEXT_MAX),
      measures: z.array(z.string().max(DRAFT_MEASURE_MAX)).max(DRAFT_MEASURES_MAX),
    })
    .optional(),
  vision: z.string().max(DRAFT_VISION_MAX),
  brief: z.string().max(DRAFT_BRIEF_MAX),
  fields: z
    .array(z.object({ id: Id, text: z.string().max(DRAFT_FIELD_MAX) }))
    .max(DRAFT_FIELDS_MAX),
  sections: z
    .array(
      z.object({
        id: Id,
        items: z.array(z.string().max(DRAFT_LINE_MAX)).max(DRAFT_SECTION_LINES_MAX),
      })
    )
    .max(DRAFT_SECTIONS_MAX),
  stories: z.array(z.string().max(DRAFT_STORY_MAX)).max(DRAFT_STORIES_MAX),
}) satisfies z.ZodType<CanvasDraftInput>;

const draftOutput = z.object({
  items: z
    .array(
      z.object({
        section: Id,
        text: z.string().min(1).max(DRAFT_OUT_TEXT_MAX),
        detail: z.string().max(DRAFT_OUT_DETAIL_MAX).optional(),
      })
    )
    .max(DRAFT_OUT_ITEMS_MAX),
  fields: z
    .array(z.object({ id: Id, text: z.string().min(1).max(DRAFT_OUT_FIELD_MAX) }))
    .max(DRAFT_OUT_FIELDS_MAX),
}) satisfies z.ZodType<CanvasDraftOutput>;

export const productCanvasDraftTask = defineAiTask<CanvasDraftInput, CanvasDraftOutput>({
  id: "product-canvas.draft",
  toolId: "product-canvas",
  tier: "full",
  effort: "low",
  maxTokens: 8192,
  input: draftInput,
  output: draftOutput,
  fallback: productCanvasDraftFallback,
  sample: {
    format: "vision-board",
    title: "Tapline",
    goal: {
      statement:
        "Shop owners take every in-person payment on their own phone, with no card machine to rent.",
      why: "Renting a card machine is the main cost our shops tell us about.",
      measures: ["Share of active shops with no card machine: 40% today, 70% target"],
    },
    vision:
      "Small shop owners take payments anywhere, without a card machine, and see their money the next day.",
    brief: "Stall holders at weekend markets lose sales when a buyer has no cash.",
    fields: [{ id: "pitch-name", text: "Tapline" }],
    sections: [{ id: "who", items: ["Stall holders at weekend markets"] }],
    stories: [
      "Tap to pay on the shop owner's phone",
      "Take a payment with no signal and send it later",
      "Refund a payment from the phone",
    ],
  },
});

const gapsInput = z.object({
  format: Format,
  title: z.string().max(GAPS_TITLE_MAX),
  goal: z
    .object({
      statement: z.string().max(GAPS_GOAL_TEXT_MAX),
      why: z.string().max(GAPS_GOAL_TEXT_MAX),
    })
    .optional(),
  today: z.string().max(GAPS_TODAY_MAX).optional(),
  appetiteWeeks: z.number().int().min(1).max(WEEKS_MAX).optional(),
  cycleEnded: z.string().max(GAPS_TODAY_MAX).optional(),
  similar: z.array(z.string().max(GAPS_SIMILAR_TEXT_MAX)).max(GAPS_SIMILAR_MAX).optional(),
  fields: z
    .array(z.object({ id: z.string().max(GAPS_ID_MAX), text: z.string().max(GAPS_FIELD_MAX) }))
    .max(GAPS_FIELDS_MAX),
  sections: z
    .array(
      z.object({
        id: z.string().max(GAPS_ID_MAX),
        items: z
          .array(
            z.object({
              text: z.string().max(GAPS_LINE_MAX),
              evidence: z.enum(PRODUCT_CANVAS_EVIDENCE).optional(),
              linked: z.boolean(),
              answered: z.boolean().optional(),
              asks: z.string().max(GAPS_ID_MAX).optional(),
            })
          )
          .max(GAPS_SECTION_LINES_MAX),
      })
    )
    .max(GAPS_SECTIONS_MAX),
}) satisfies z.ZodType<CanvasGapsInput>;

const gapsOutput = z.object({
  gaps: z
    .array(
      z.object({
        section: z.string().max(GAPS_ID_MAX).optional(),
        text: z.string().min(1).max(GAPS_OUT_TEXT_MAX),
      })
    )
    .max(GAPS_OUT_MAX),
}) satisfies z.ZodType<CanvasGapsOutput>;

export const productCanvasGapsTask = defineAiTask<CanvasGapsInput, CanvasGapsOutput>({
  id: "product-canvas.gaps",
  toolId: "product-canvas",
  tier: "full",
  effort: "high",
  maxTokens: 6144,
  input: gapsInput,
  output: gapsOutput,
  fallback: productCanvasGapsFallback,
  sample: {
    format: "value-proposition",
    title: "Stall holders at weekend markets",
    goal: {
      statement:
        "Shop owners take every in-person payment on their own phone, with no card machine to rent.",
      why: "Renting a card machine is the main cost our shops tell us about.",
    },
    today: "2026-11-23",
    fields: [{ id: "customer", text: "Stall holders at weekend markets, on a busy Saturday" }],
    sections: [
      {
        id: "pains",
        items: [
          { text: "No signal in the market hall", evidence: "fact", linked: true, answered: false },
          { text: "Buyers with no cash walk away", evidence: "assumption", linked: false },
        ],
      },
      { id: "eases", items: [{ text: "Take the payment offline, send it later", linked: true }] },
    ],
  },
});
