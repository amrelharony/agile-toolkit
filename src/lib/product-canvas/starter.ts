/**
 * Drafting a canvas: the shapes the `product-canvas.draft` task sends and
 * gets back, the draft with no AI (`starterDraft`, which the task's
 * fallback and Amr's `create_canvas {fromGoal}` both use), and the filter
 * every drafted answer goes through before anyone sees it (`draftOffer`).
 *
 * The draft never writes: the page offers its lines through
 * <AiSuggestions>, and accepted lines go through the model's
 * `withDraftLines` (the kit's `addDraftLines`), with Undo. A box that holds
 * text is only ever replaced one at a time, through a "Replace" step.
 *
 * Pure and server-safe: no zod, no React, no "use client" import.
 */

import { commonTheme } from "@/lib/ai/tasks/product-goal.lite";
import { draftLinesFor, lineKey, type DraftLine } from "@/lib/sectioned/model";
import type { ProductCanvas, ProductCanvasFormat } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import { CANVAS_ITEMS_MAX, QUESTIONS_SECTION, productFormat, sectionDef } from "./formats";
import {
  DETAIL_MAX,
  ITEM_MAX,
  LONG_MAX,
  itemCount,
  itemsOf,
  oneLine,
  type AcceptedLine,
} from "./model";

/* ── The draft task's shapes and caps ─────────────────────────────── */

export const DRAFT_TITLE_MAX = 200;
export const DRAFT_GOAL_TEXT_MAX = 1000;
export const DRAFT_MEASURES_MAX = 10;
export const DRAFT_MEASURE_MAX = 200;
export const DRAFT_VISION_MAX = 2000;
/** A short brief typed beside the button (never stored). */
export const DRAFT_BRIEF_MAX = 500;
export const DRAFT_ID_MAX = 40;
/** The one-line and paragraph boxes sent, each cut to this. */
export const DRAFT_FIELDS_MAX = 12;
export const DRAFT_FIELD_MAX = 600;
/** The list boxes sent, each with its newest lines. */
export const DRAFT_SECTIONS_MAX = 10;
export const DRAFT_SECTION_LINES_MAX = 8;
export const DRAFT_LINE_MAX = 200;
export const DRAFT_STORIES_MAX = 20;
export const DRAFT_STORY_MAX = 200;
/** What comes back: lines for list boxes and text for the other boxes. */
export const DRAFT_OUT_ITEMS_MAX = 20;
export const DRAFT_OUT_TEXT_MAX = 200;
export const DRAFT_OUT_DETAIL_MAX = 300;
export const DRAFT_OUT_FIELDS_MAX = 8;
export const DRAFT_OUT_FIELD_MAX = 600;

/** What the draft task sends: the canvas's words and what it can start from. No requester, owner or link ever goes. */
export interface CanvasDraftInput {
  format: ProductCanvasFormat;
  title: string;
  goal?: { statement: string; why: string; measures: string[] };
  vision: string;
  brief: string;
  /** The one-line and paragraph boxes that hold text. */
  fields: { id: string; text: string }[];
  /** The list boxes that hold lines, each with its newest lines. */
  sections: { id: string; items: string[] }[];
  /** The backlog's story titles, for the product's common theme. */
  stories: string[];
}

/** What the draft task answers: lines for list boxes (`section`), text for the other boxes (`id`). */
export interface CanvasDraftOutput {
  items: { section: string; text: string; detail?: string }[];
  fields: { id: string; text: string }[];
}

/* ── The draft with no AI ─────────────────────────────────────────── */

const cut = (text: string, max: number) => cutText(text.trim(), max).trim();
const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * A draft from what the canvas can start from, with no AI. Only empty boxes
 * are filled:
 * - a box with a Product Goal source takes it (the vision from the vision,
 *   the Lean UX problem from the goal's why, a PR/FAQ summary from its
 *   statement, business outcomes and gains from its measures, one line
 *   each);
 * - "What it is" takes the backlog's common theme, with a [placeholder]
 *   for what makes it stand out;
 * - the format's lead box takes the brief when nothing else fills it;
 * - any other box gets its own [bracketed] starter line, which the gaps
 *   then flag until it is filled in.
 * Open questions and the launch date are left to the person. Throws for a
 * format this build doesn't offer.
 */
export function starterDraft(input: CanvasDraftInput): CanvasDraftOutput {
  const format = productFormat(input.format);
  if (!format) throw new Error(`Product Canvas can't draft a "${input.format}" canvas.`);
  const filled = new Set(input.fields.filter((f) => f.text.trim()).map((f) => f.id));
  const listed = new Set(
    input.sections.filter((s) => s.items.some((t) => t.trim())).map((s) => s.id)
  );
  const goal = input.goal;
  const vision = input.vision.trim();
  const brief = input.brief.trim();
  const theme = commonTheme(input.stories);

  // Real words first (from the goal, the vision, the brief), then starters.
  const fields: { id: string; text: string; real: boolean }[] = [];
  const items: { section: string; text: string; real: boolean }[] = [];
  for (const def of format.sections) {
    if (def.id === QUESTIONS_SECTION || def.typedOnly) continue;
    if (def.kind !== "list") {
      if (filled.has(def.id)) continue;
      const from =
        def.fromGoal === "vision"
          ? vision
          : def.fromGoal === "statement"
            ? (goal?.statement.trim() ?? "")
            : def.fromGoal === "why"
              ? (goal?.why.trim() ?? "")
              : "";
      const real = from || (def.id === format.lead ? brief : "");
      const text = real || def.starter || "";
      const max =
        def.kind === "long" ? DRAFT_OUT_FIELD_MAX : Math.min(ITEM_MAX, DRAFT_OUT_FIELD_MAX);
      if (text) fields.push({ id: def.id, text: cut(text, max), real: Boolean(real) });
      continue;
    }
    if (listed.has(def.id)) continue;
    if (def.fromGoal === "measures" && goal && goal.measures.some((m) => m.trim())) {
      for (const m of goal.measures.filter((x) => x.trim()).slice(0, def.max)) {
        items.push({ section: def.id, text: cut(oneLine(m), DRAFT_OUT_TEXT_MAX), real: true });
      }
      continue;
    }
    if (def.fromGoal === "theme" && theme) {
      items.push({
        section: def.id,
        text: cut(`${capital(theme)}: [what makes ours stand out]`, DRAFT_OUT_TEXT_MAX),
        real: true,
      });
      continue;
    }
    if (def.starter)
      items.push({ section: def.id, text: cut(def.starter, DRAFT_OUT_TEXT_MAX), real: false });
  }
  const realFirst = <T extends { real: boolean }>(list: T[]) => [
    ...list.filter((x) => x.real),
    ...list.filter((x) => !x.real),
  ];
  return {
    items: realFirst(items)
      .slice(0, DRAFT_OUT_ITEMS_MAX)
      .map(({ section, text }) => ({ section, text })),
    fields: realFirst(fields)
      .slice(0, DRAFT_OUT_FIELDS_MAX)
      .map(({ id, text }) => ({ id, text })),
  };
}

/** Why the draft button can't help yet, or null: it needs a goal, the vision, a brief or one box. */
export function draftDisabledReason(input: CanvasDraftInput): string | null {
  const something =
    Boolean(input.goal?.statement.trim()) ||
    Boolean(input.vision.trim()) ||
    Boolean(input.brief.trim()) ||
    input.fields.some((f) => f.text.trim()) ||
    input.sections.some((s) => s.items.some((t) => t.trim()));
  return something ? null : "Write the Product Goal, a short brief or one box first.";
}

/* ── The filter every drafted answer goes through ─────────────────── */

/** A drafted line for an empty box, or a list line (with the answer a question list takes). */
export type OfferLine = AcceptedLine;

/** A drafted wording for a box that already holds text: offered one at a time, as "Replace". */
export interface OfferReplace {
  sectionId: string;
  text: string;
  /** The box's text now. */
  current: string;
}

export interface DraftOffer {
  /** New list lines and empty boxes, in the format's order: one, all or none. */
  lines: OfferLine[];
  /** Boxes that hold text, with another wording. */
  replaces: OfferReplace[];
  /** Lines the boxes or the canvas had no room for. */
  dropped: number;
}

/**
 * A drafted answer, from the AI or `starterDraft`, made safe to offer:
 * only the format's own boxes, never one only the team writes (the launch
 * date); list lines through the kit's `draftLinesFor`
 * (lines already there and repeats dropped, each box kept to its room),
 * then the canvas kept to CANVAS_ITEMS_MAX; an answer only on a question
 * list; text for an empty one-line or paragraph box offered with the new
 * lines, and for one that holds text as a "Replace" (never in "all").
 */
export function draftOffer(canvas: ProductCanvas, output: CanvasDraftOutput): DraftOffer {
  const format = productFormat(canvas.format);
  if (!format) return { lines: [], replaces: [], dropped: 0 };
  const fills: OfferLine[] = [];
  const replaces: OfferReplace[] = [];
  const seenFields = new Set<string>();
  for (const f of output.fields) {
    const def = sectionDef(format, f.id);
    if (!def || def.kind === "list" || def.typedOnly || seenFields.has(def.id)) continue;
    seenFields.add(def.id);
    const max = def.kind === "long" ? LONG_MAX : ITEM_MAX;
    const text =
      def.kind === "long" ? cut(f.text.replace(/\r\n?/g, "\n"), max) : cut(oneLine(f.text), max);
    if (!text) continue;
    const current = itemsOf(canvas, def.id)[0]?.text.trim() ?? "";
    if (!current) fills.push({ sectionId: def.id, text });
    else if (lineKey(current) !== lineKey(text))
      replaces.push({ sectionId: def.id, text, current });
  }
  const candidates: (DraftLine & { detail?: string })[] = output.items.flatMap((i) => {
    const def = sectionDef(format, i.section);
    if (!def || def.kind !== "list" || def.typedOnly) return [];
    const detail = def.qa ? cut(i.detail ?? "", DETAIL_MAX) : "";
    return [{ sectionId: def.id, text: i.text, ...(detail ? { detail } : {}) }];
  });
  const filtered = draftLinesFor(format, canvas.sections, candidates);
  const details = new Map<string, string>();
  for (const c of candidates) {
    const key = `${c.sectionId}\u0000${lineKey(c.text)}`;
    if (c.detail && !details.has(key)) details.set(key, c.detail);
  }
  let room = CANVAS_ITEMS_MAX - itemCount(canvas) - fills.length;
  let dropped = filtered.dropped;
  const lines: OfferLine[] = [];
  for (const line of filtered.lines) {
    if (room <= 0) {
      dropped++;
      continue;
    }
    room--;
    const detail = details.get(`${line.sectionId}\u0000${lineKey(line.text)}`);
    lines.push({
      sectionId: line.sectionId,
      text: cut(line.text, ITEM_MAX),
      ...(detail ? { detail } : {}),
    });
  }
  const order = new Map(format.sections.map((d, i) => [d.id, i]));
  const all = [...fills, ...lines].sort(
    (a, b) => (order.get(a.sectionId) ?? 0) - (order.get(b.sectionId) ?? 0)
  );
  return { lines: all, replaces, dropped };
}
