/**
 * Product Canvas's AI tasks, the lite half pages import (no zod; the defs,
 * with their schemas, are `product-canvas.ts` and load on first AI use):
 *   - product-canvas.draft: lines for a canvas's boxes, from the Product
 *     Goal, the vision, a short brief and the backlog's titles;
 *   - product-canvas.gaps: what the canvas still lacks, said as questions.
 * Both answer without AI: the draft with `starterDraft` (the goal's words
 * and [bracketed] starter lines), the gaps with the page's own rules.
 *
 * Each input is built from the canvas here (never a requester, owner or
 * link) and fitted to TOOL_AI_BODY_BUDGET before it is sent.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import {
  DRAFT_BRIEF_MAX,
  DRAFT_FIELDS_MAX,
  DRAFT_FIELD_MAX,
  DRAFT_GOAL_TEXT_MAX,
  DRAFT_LINE_MAX,
  DRAFT_MEASURES_MAX,
  DRAFT_MEASURE_MAX,
  DRAFT_SECTIONS_MAX,
  DRAFT_SECTION_LINES_MAX,
  DRAFT_STORIES_MAX,
  DRAFT_STORY_MAX,
  DRAFT_TITLE_MAX,
  DRAFT_VISION_MAX,
  starterDraft,
  type CanvasDraftInput,
  type CanvasDraftOutput,
} from "@/lib/product-canvas/starter";
import { productFormat } from "@/lib/product-canvas/formats";
import { LIKELY_MAX } from "@/lib/product-canvas/fields";
import {
  formatOf,
  gapViewOf,
  gapsOf,
  itemsOf,
  type GapContext,
  type GapLine,
} from "@/lib/product-canvas/model";
import type {
  ProductCanvas,
  ProductCanvasEvidence,
  ProductCanvasFormat,
} from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import { jsonBytes } from "@/lib/utils/json-bytes";

export type { CanvasDraftInput, CanvasDraftOutput } from "@/lib/product-canvas/starter";

/* ── The gaps task's shapes and caps ──────────────────────────────── */

export const GAPS_TITLE_MAX = 200;
export const GAPS_GOAL_TEXT_MAX = 1000;
export const GAPS_TODAY_MAX = 10;
export const GAPS_ID_MAX = 40;
export const GAPS_FIELDS_MAX = 12;
export const GAPS_FIELD_MAX = 1000;
export const GAPS_SECTIONS_MAX = 10;
export const GAPS_SECTION_LINES_MAX = 20;
export const GAPS_LINE_MAX = 200;
/** An open idea's look-alikes in the inbox: their titles, never who asked. */
export const GAPS_SIMILAR_MAX = LIKELY_MAX;
export const GAPS_SIMILAR_TEXT_MAX = 200;
/** What comes back: gaps, each short enough to be an open question as it is. */
export const GAPS_OUT_MAX = 8;
export const GAPS_OUT_TEXT_MAX = 200;

/** What the gaps task sends: the canvas as the gap rules read it, no names. */
export interface CanvasGapsInput {
  format: ProductCanvasFormat;
  title: string;
  goal?: { statement: string; why: string };
  /** YYYY-MM-DD, for a launch date that has passed. */
  today?: string;
  /** A Shape Up pitch's appetite, in weeks. */
  appetiteWeeks?: number;
  /** A Shape Up bet still running after its cycle: the cycle's last day. */
  cycleEnded?: string;
  /** An open idea: the titles of the inbox's ideas that look like it. */
  similar?: string[];
  fields: { id: string; text: string }[];
  sections: {
    id: string;
    items: {
      text: string;
      evidence?: ProductCanvasEvidence;
      linked: boolean;
      answered?: boolean;
      asks?: string;
    }[];
  }[];
}

export interface CanvasGapsOutput {
  gaps: { section?: string; text: string }[];
}

/* ── Building the inputs ──────────────────────────────────────────── */

const cut = (text: string, max: number) => cutText(text.trim(), max).trim();

export interface DraftContext {
  goal?: { statement: string; why?: string; measures?: readonly string[] } | null;
  vision?: string;
  brief?: string;
  stories?: readonly string[];
}

/**
 * The draft task's input from a canvas: its name, its boxes' words (the
 * list boxes' newest lines), and what it can start from. Owners, answers'
 * authors, links and sends never go.
 */
export function draftInputFor(canvas: ProductCanvas, ctx: DraftContext = {}): CanvasDraftInput {
  const format = formatOf(canvas);
  const fields: CanvasDraftInput["fields"] = [];
  const sections: CanvasDraftInput["sections"] = [];
  for (const def of format.sections) {
    const items = itemsOf(canvas, def.id);
    if (def.kind !== "list") {
      const text = cut(items[0]?.text ?? "", DRAFT_FIELD_MAX);
      if (text && fields.length < DRAFT_FIELDS_MAX) fields.push({ id: def.id, text });
      continue;
    }
    const lines = items
      .map((i) => cut(i.text, DRAFT_LINE_MAX))
      .filter(Boolean)
      .slice(-DRAFT_SECTION_LINES_MAX);
    if (lines.length > 0 && sections.length < DRAFT_SECTIONS_MAX) {
      sections.push({ id: def.id, items: lines });
    }
  }
  const input: CanvasDraftInput = {
    format: format.id,
    title: cut(canvas.title, DRAFT_TITLE_MAX),
    vision: cut(ctx.vision ?? "", DRAFT_VISION_MAX),
    brief: cut(ctx.brief ?? "", DRAFT_BRIEF_MAX),
    fields,
    sections,
    stories: (ctx.stories ?? [])
      .map((s) => cut(s, DRAFT_STORY_MAX))
      .filter(Boolean)
      .slice(0, DRAFT_STORIES_MAX),
  };
  const statement = cut(ctx.goal?.statement ?? "", DRAFT_GOAL_TEXT_MAX);
  if (statement) {
    input.goal = {
      statement,
      why: cut(ctx.goal?.why ?? "", DRAFT_GOAL_TEXT_MAX),
      measures: (ctx.goal?.measures ?? [])
        .map((m) => cut(m, DRAFT_MEASURE_MAX))
        .filter(Boolean)
        .slice(0, DRAFT_MEASURES_MAX),
    };
  }
  return input;
}

/** The gaps task's input from a canvas: the gap rules' view of it, cut to the caps. */
export function gapsInputFor(canvas: ProductCanvas, ctx: GapContext = {}): CanvasGapsInput {
  const view = gapViewOf(canvas, ctx);
  const input: CanvasGapsInput = {
    format: view.format,
    title: cut(canvas.title, GAPS_TITLE_MAX),
    fields: Object.entries(view.fields)
      .slice(0, GAPS_FIELDS_MAX)
      .map(([id, text]) => ({ id, text: cut(text, GAPS_FIELD_MAX) })),
    sections: Object.entries(view.lists)
      .slice(0, GAPS_SECTIONS_MAX)
      .map(([id, lines]) => ({
        id,
        items: lines.slice(-GAPS_SECTION_LINES_MAX).map((l) => {
          const item: CanvasGapsInput["sections"][number]["items"][number] = {
            text: cut(l.text, GAPS_LINE_MAX),
            linked: l.linked,
            answered: l.answered,
          };
          if (l.evidence) item.evidence = l.evidence;
          if (l.asks) item.asks = cut(l.asks, GAPS_ID_MAX);
          return item;
        }),
      })),
  };
  if (view.goal) {
    input.goal = {
      statement: cut(view.goal.statement, GAPS_GOAL_TEXT_MAX),
      why: cut(view.goal.why, GAPS_GOAL_TEXT_MAX),
    };
  }
  if (view.today) input.today = view.today.slice(0, GAPS_TODAY_MAX);
  if (view.appetiteWeeks !== undefined) input.appetiteWeeks = view.appetiteWeeks;
  if (view.cycleEnded) input.cycleEnded = view.cycleEnded.slice(0, GAPS_TODAY_MAX);
  if (view.similar?.length) {
    input.similar = view.similar
      .slice(0, GAPS_SIMILAR_MAX)
      .map((t) => cut(t, GAPS_SIMILAR_TEXT_MAX))
      .filter(Boolean);
  }
  return input;
}

/* ── Fitting the inputs to a request ──────────────────────────────── */

/**
 * The draft's input, trimmed until its request (`{task, input}`) fits
 * `budget` bytes: the backlog's titles from the end, then each list box's
 * oldest line, a round at a time (keeping its newest), then the boxes'
 * texts cut to 200 characters, then whole list boxes from the end. The
 * input as it is when it already fits.
 */
export function fitDraftInput(
  input: CanvasDraftInput,
  budget: number = TOOL_AI_BODY_BUDGET
): CanvasDraftInput {
  const size = (i: CanvasDraftInput) => jsonBytes({ task: "product-canvas.draft", input: i });
  if (size(input) <= budget) return input;
  const next: CanvasDraftInput = {
    ...input,
    stories: [...input.stories],
    fields: input.fields.map((f) => ({ ...f })),
    sections: input.sections.map((s) => ({ ...s, items: [...s.items] })),
  };
  while (next.stories.length > 0 && size(next) > budget) next.stories.pop();
  trimRounds(next.sections, () => size(next) > budget);
  for (const f of next.fields) {
    if (size(next) <= budget) break;
    f.text = cut(f.text, DRAFT_LINE_MAX);
  }
  while (next.sections.length > 0 && size(next) > budget) next.sections.pop();
  return next;
}

/** The gaps' input, trimmed as the draft's is (it has no titles to drop). */
export function fitGapsInput(
  input: CanvasGapsInput,
  budget: number = TOOL_AI_BODY_BUDGET
): CanvasGapsInput {
  const size = (i: CanvasGapsInput) => jsonBytes({ task: "product-canvas.gaps", input: i });
  if (size(input) <= budget) return input;
  const next: CanvasGapsInput = {
    ...input,
    fields: input.fields.map((f) => ({ ...f })),
    sections: input.sections.map((s) => ({ ...s, items: [...s.items] })),
  };
  trimRounds(next.sections, () => size(next) > budget);
  for (const f of next.fields) {
    if (size(next) <= budget) break;
    f.text = cut(f.text, GAPS_LINE_MAX);
  }
  while (next.sections.length > 0 && size(next) > budget) next.sections.pop();
  return next;
}

/** Each box's oldest line out, one round at a time, while `over()` and a box has two or more. */
function trimRounds(sections: { items: unknown[] }[], over: () => boolean): void {
  while (over() && sections.some((s) => s.items.length > 1)) {
    for (const s of sections) {
      if (!over()) return;
      if (s.items.length > 1) s.items.shift();
    }
  }
}

/* ── The answers without AI ───────────────────────────────────────── */

/** The draft without AI: the goal's words where a box starts from them, starter lines elsewhere. */
export const productCanvasDraftFallback = (i: CanvasDraftInput): CanvasDraftOutput =>
  starterDraft(i);

/** The gaps without AI: the page's own rules, over what the input holds. */
export function productCanvasGapsFallback(i: CanvasGapsInput): CanvasGapsOutput {
  if (!productFormat(i.format)) {
    throw new Error(`Product Canvas can't check a "${i.format}" canvas.`);
  }
  const fields: Record<string, string> = {};
  for (const f of i.fields) if (f.text.trim()) fields[f.id] = f.text;
  const lists: Record<string, GapLine[]> = {};
  for (const s of i.sections) {
    lists[s.id] = s.items.map((l) => ({
      text: l.text,
      linked: l.linked,
      answered: l.answered ?? false,
      ...(l.evidence ? { evidence: l.evidence } : {}),
      ...(l.asks ? { asks: l.asks } : {}),
    }));
  }
  const gaps = gapsOf({
    format: i.format,
    fields,
    lists,
    ...(i.goal?.statement.trim() ? { goal: i.goal } : {}),
    ...(i.today ? { today: i.today } : {}),
    ...(i.appetiteWeeks !== undefined ? { appetiteWeeks: i.appetiteWeeks } : {}),
    ...(i.cycleEnded ? { cycleEnded: i.cycleEnded } : {}),
    ...(i.similar?.length ? { similar: i.similar } : {}),
  });
  return {
    gaps: gaps.slice(0, GAPS_OUT_MAX).map((g) => ({
      ...(g.sectionId ? { section: g.sectionId } : {}),
      text: cut(g.text, GAPS_OUT_TEXT_MAX),
    })),
  };
}

/* ── The refs ─────────────────────────────────────────────────────── */

export const productCanvasDraftTask = lazyAiTask<CanvasDraftInput, CanvasDraftOutput>(
  { id: "product-canvas.draft", toolId: "product-canvas", fallback: productCanvasDraftFallback },
  () => import("./product-canvas").then((m) => m.productCanvasDraftTask)
);

export const productCanvasGapsTask = lazyAiTask<CanvasGapsInput, CanvasGapsOutput>(
  { id: "product-canvas.gaps", toolId: "product-canvas", fallback: productCanvasGapsFallback },
  () => import("./product-canvas").then((m) => m.productCanvasGapsTask)
);
