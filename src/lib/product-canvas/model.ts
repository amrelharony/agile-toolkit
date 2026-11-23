/**
 * Product Canvas's model: reading a canvas, every write the page and Amr's
 * verbs make, and what the page works out from a canvas (the pitch, the
 * fit meter, the hypothesis sentence, the press release's words, the hard
 * questions, the gaps).
 *
 * A canvas is one `ProductCanvas` record: its format's boxes, keyed by the
 * format's section ids (the sectioned kit, lib/sectioned). Every write goes
 * through here, so the page, Amr and the CRUD's write guard agree:
 *   - a list line and a one-line box hold TOOL_TEXT_MAX.short, a paragraph
 *     box and a question's answer TOOL_TEXT_MAX.text;
 *   - a box holds its format's `max`, and a canvas TOOL_LIST_MAX.canvasItems
 *     lines in all;
 *   - a write that would pass one synced row (ENTITY_ROW_MAX_BYTES) is
 *     refused with the CRUD's own sentence.
 * Writes stamp `updatedAt` with the `now` they are given; the store stamps
 * nothing.
 *
 * Pure and server-safe: no zod, no React, no store, no "use client" import.
 */

import { nanoid } from "nanoid";
import {
  addDraftLines,
  cleanSections,
  hasPlaceholder,
  lineKey,
  roomLeft,
  type AddedLine,
  type DraftLine,
  type Sections,
} from "@/lib/sectioned/model";
import {
  HANDOFF_ROUTE_IDS,
  PRODUCT_CANVAS_EVIDENCE,
  PRODUCT_CANVAS_FORMATS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HandoffRouteId,
  type Hypothesis,
  type ProductCanvas,
  type ProductCanvasEvidence,
  type ProductCanvasFormat,
  type ProductCanvasItem,
} from "@/lib/stores/workspace-types";
import { linkedTest } from "@/lib/hypotheses/model";
import { isIsoDay } from "@/lib/product-goal/model";
import { cutText } from "@/lib/utils/cut-text";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";
import { cardWords, stem } from "@/app/(tools)/retro/themes";
import { TOO_BIG_TO_SAVE, fitsEntity } from "./bytes";
import {
  CANVAS_ITEMS_MAX,
  FEATURE_WORDS,
  HARD_QUESTIONS,
  HEADLINE_WORDS_MAX,
  JARGON_WORDS,
  PRESS_RELEASE_SECTIONS,
  QUESTIONS_SECTION,
  RELEASE_WORDS_NOTE,
  VISION_GROUPS_MAX,
  VISION_WORDS_MAX,
  isHardQuestionId,
  productFormat,
  sectionDef,
  type ProductFormat,
  type ProductSectionDef,
} from "./formats";

/** The CRUD's ids for a canvas start with this (`workspace.product_canvas`). */
export const PRODUCT_CANVAS_ID_PREFIX = "pcanvas_";
/** The tool's id, as hand-offs and history name it. */
export const PRODUCT_CANVAS_TOOL = "product-canvas";

/** A canvas's name. */
export const TITLE_MAX = TOOL_TEXT_MAX.short;
/** A list line, and a one-line box. */
export const ITEM_MAX = TOOL_TEXT_MAX.short;
/** A paragraph box. */
export const LONG_MAX = TOOL_TEXT_MAX.text;
/** A question's answer. */
export const DETAIL_MAX = TOOL_TEXT_MAX.text;
/** One link's id on a line (the CRUD's cap). */
export const LINK_ID_MAX = 40;
/** Links on one line. */
export const LINKS_MAX = TOOL_LIST_MAX.itemLinks;

/** A new canvas's id: what the CRUD mints too. */
export const newCanvasId = () => `${PRODUCT_CANVAS_ID_PREFIX}${nanoid(8)}`;
/** A new line's id. */
export const newItemId = () => nanoid(8);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One line, trimmed: line breaks and runs of spaces become one space. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A one-line value, cut to `max`; "" for anything but a string. */
export function cleanLine(value: unknown, max: number): string {
  return typeof value === "string" ? cutText(oneLine(value), max).trim() : "";
}

/** A paragraph, line breaks kept, trimmed and cut to `max`; "" for anything but a string. */
export function cleanPara(value: unknown, max: number): string {
  return typeof value === "string" ? cutText(value.replace(/\r\n?/g, "\n").trim(), max).trim() : "";
}

const EVIDENCE: ReadonlySet<string> = new Set(PRODUCT_CANVAS_EVIDENCE);
export const isEvidence = (v: unknown): v is ProductCanvasEvidence =>
  typeof v === "string" && EVIDENCE.has(v);

/** The text cap of a box's lines: paragraph boxes take more. */
export const textMaxOf = (def: ProductSectionDef) => (def.kind === "long" ? LONG_MAX : ITEM_MAX);

const ROUTES: ReadonlySet<string> = new Set(HANDOFF_ROUTE_IDS);

/** Valid hand-off links only, one per route (the last one wins); undefined when none is left. */
export function cleanSentTo(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byRoute = new Map<string, HandoffLink>();
  for (const l of raw) {
    if (!isRecord(l)) continue;
    const { route, targetId, at } = l;
    if (typeof route !== "string" || !ROUTES.has(route)) continue;
    if (typeof targetId !== "string" || !targetId || typeof at !== "string" || !at) continue;
    byRoute.delete(route);
    byRoute.set(route, { route: route as HandoffRouteId, targetId, at });
  }
  return byRoute.size > 0 ? Array.from(byRoute.values()) : undefined;
}

/* ── Reading a canvas ─────────────────────────────────────────────── */

/** Item ids per box, for checking links. */
function idsBySection(sections: Sections<ProductCanvasItem>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, items] of Object.entries(sections)) {
    out.set(id, new Set(items.map((i) => i.id)));
  }
  return out;
}

/** The ids a line in `def` may link to. */
function linkTargets(def: ProductSectionDef, ids: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const s of def.linksTo ?? []) ids.get(s)?.forEach((id) => out.add(id));
  return out;
}

/** One line read against its box: the product fields kept only where the box takes them. */
function readItem(
  item: ProductCanvasItem,
  def: ProductSectionDef,
  ids: Map<string, Set<string>>
): ProductCanvasItem {
  const out: ProductCanvasItem = { id: item.id, text: item.text };
  if (item.owner) out.owner = item.owner;
  if (item.sentTo) out.sentTo = item.sentTo;
  if (def.evidence && isEvidence(item.evidence)) out.evidence = item.evidence;
  if (def.qa) {
    const detail = cleanPara(item.detail, DETAIL_MAX);
    if (detail) out.detail = detail;
  }
  if (def.linksTo && Array.isArray(item.links)) {
    const ok = linkTargets(def, ids);
    const links: string[] = [];
    for (const l of item.links) {
      if (links.length >= LINKS_MAX) break;
      if (typeof l !== "string" || l.length > LINK_ID_MAX || !ok.has(l) || links.includes(l)) {
        continue;
      }
      links.push(l);
    }
    if (links.length > 0) out.links = links;
  }
  if (def.hardQuestions && isHardQuestionId(item.promptId)) out.promptId = item.promptId;
  if (def.niceToHave && item.niceToHave === true) out.niceToHave = true;
  return out;
}

/**
 * A canvas's boxes read against its format: the kit's `cleanSections`
 * first (unknown boxes dropped, each box cut to its `max`, text cut to its
 * cap), then ids made unique across the canvas, the canvas cut to
 * CANVAS_ITEMS_MAX lines in format order, and each line's own fields kept
 * only where its box takes them (evidence, an answer, links to lines that
 * are there, a known hard question).
 */
export function readSections(raw: unknown, format: ProductFormat): Sections<ProductCanvasItem> {
  const base = cleanSections<ProductCanvasItem>(raw, format, {
    itemMax: ITEM_MAX,
    longMax: LONG_MAX,
  });
  const seen = new Set<string>();
  let total = 0;
  const kept: Sections<ProductCanvasItem> = {};
  for (const def of format.sections) {
    const items = base[def.id];
    if (!items) continue;
    const list: ProductCanvasItem[] = [];
    for (const item of items) {
      if (seen.has(item.id) || total >= CANVAS_ITEMS_MAX) continue;
      seen.add(item.id);
      total++;
      list.push(item);
    }
    kept[def.id] = list;
  }
  const ids = idsBySection(kept);
  const out: Sections<ProductCanvasItem> = {};
  for (const def of format.sections) {
    const items = kept[def.id];
    if (items) out[def.id] = items.map((item) => readItem(item, def, ids));
  }
  return out;
}

/**
 * A stored or received canvas, for every read and before every write: null
 * for anything without an id, or in a format this build doesn't offer.
 * The name falls back to the format's; fields the format doesn't use (an
 * inbox's intake on a Vision Board) are left out.
 */
export function readCanvas(raw: unknown): ProductCanvas | null {
  if (!isRecord(raw)) return null;
  const { id } = raw;
  if (typeof id !== "string" || !id) return null;
  const format = productFormat(raw.format);
  if (!format) return null;
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  const out: ProductCanvas = {
    id,
    format: format.id,
    title: cleanLine(raw.title, TITLE_MAX) || format.name,
    sections: readSections(raw.sections, format),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : updatedAt,
    updatedAt,
  };
  const goalId = cleanLine(raw.productGoalId, TOOL_TEXT_MAX.short);
  if (goalId) out.productGoalId = goalId;
  const sentTo = cleanSentTo(raw.sentTo);
  if (sentTo) out.sentTo = sentTo;
  return out;
}

/** Every readable canvas in a list, newest change first. */
export function readCanvases(rows: readonly unknown[] | undefined): ProductCanvas[] {
  return (rows ?? [])
    .flatMap((r) => {
      const c = readCanvas(r);
      return c ? [c] : [];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** The format a canvas is in (readCanvas only returns canvases in a known one). */
export function formatOf(canvas: ProductCanvas): ProductFormat {
  const format = productFormat(canvas.format);
  if (!format) throw new Error(`Product Canvas has no "${canvas.format}" format.`);
  return format;
}

/** A box's lines. */
export const itemsOf = (canvas: ProductCanvas, sectionId: string): ProductCanvasItem[] =>
  Object.prototype.hasOwnProperty.call(canvas.sections, sectionId)
    ? canvas.sections[sectionId]
    : [];

/** A one-line or paragraph box's text ("" when empty). */
export const answerOf = (canvas: ProductCanvas, sectionId: string): string =>
  itemsOf(canvas, sectionId)[0]?.text.trim() ?? "";

/** Every line on a canvas, all boxes together. */
export const itemCount = (canvas: Pick<ProductCanvas, "sections">): number =>
  Object.values(canvas.sections).reduce((n, items) => n + items.length, 0);

/** A line anywhere on the canvas, with its box. */
export function findItem(
  canvas: ProductCanvas,
  itemId: string
): { def: ProductSectionDef; item: ProductCanvasItem } | null {
  const format = formatOf(canvas);
  for (const def of format.sections) {
    const item = itemsOf(canvas, def.id).find((i) => i.id === itemId);
    if (item) return { def, item };
  }
  return null;
}

/** How many of a canvas's boxes hold something, of how many. */
export function boxesFilled(canvas: ProductCanvas): { filled: number; total: number } {
  const format = formatOf(canvas);
  const filled = format.sections.filter((d) =>
    itemsOf(canvas, d.id).some((i) => i.text.trim())
  ).length;
  return { filled, total: format.sections.length };
}

/* ── Writes ───────────────────────────────────────────────────────── */

export type CanvasRefusal =
  | "not_found"
  | "unknown_section"
  | "not_a_list"
  | "not_an_answer"
  | "section_full"
  | "canvas_full"
  | "too_big"
  | "blank"
  | "too_long"
  | "bad_field";

/** A write's result: the canvas as it would be saved, or why it can't be. */
export type CanvasWrite =
  | { ok: true; canvas: ProductCanvas }
  | { ok: false; reason: CanvasRefusal; message: string };

const refuse = (reason: CanvasRefusal, message: string): CanvasWrite => ({
  ok: false,
  reason,
  message,
});

export const CANVAS_FULL = `A canvas holds ${CANVAS_ITEMS_MAX} lines in all. Delete one to add another.`;

const unknownBox = (format: ProductFormat, sectionId: string) =>
  refuse("unknown_section", `A ${format.name} has no box called "${sectionId}".`);

const fullBox = (def: ProductSectionDef) =>
  refuse(
    "section_full",
    def.kind === "list"
      ? `"${def.label}" is full: it holds ${def.max}. Delete a line to add another.`
      : `"${def.label}" holds one answer.`
  );

/**
 * The canvas with its boxes read again and `updatedAt` stamped, or the
 * refusal when it no longer fits one synced row.
 */
function finish(canvas: ProductCanvas, sections: Sections<ProductCanvasItem>, now: string) {
  const next: ProductCanvas = {
    ...canvas,
    sections: readSections(sections, formatOf(canvas)),
    updatedAt: now,
  };
  return fitsEntity(next)
    ? ({ ok: true, canvas: next } as const)
    : refuse("too_big", TOO_BIG_TO_SAVE);
}

/** A new canvas, its boxes read against the format. */
export function newCanvas(opts: {
  id: string;
  format: ProductCanvasFormat;
  title: string;
  now: string;
  productGoalId?: string;
  sections?: Sections<ProductCanvasItem>;
}): ProductCanvas {
  const format = productFormat(opts.format);
  if (!format) throw new Error(`Product Canvas has no "${opts.format}" format.`);
  const canvas: ProductCanvas = {
    id: opts.id,
    format: format.id,
    title: cleanLine(opts.title, TITLE_MAX) || format.name,
    sections: readSections(opts.sections ?? {}, format),
    createdAt: opts.now,
    updatedAt: opts.now,
  };
  if (opts.productGoalId) canvas.productGoalId = opts.productGoalId;
  return canvas;
}

/**
 * The canvas with all its boxes replaced, read again against the format:
 * an Undo that puts back what a draft added (the kit's `removeDraftLines`).
 */
export function withSections(
  canvas: ProductCanvas,
  sections: Sections<ProductCanvasItem>,
  now: string
): CanvasWrite {
  return finish(canvas, sections, now);
}

/** The canvas renamed; a blank name is refused. */
export function withTitle(canvas: ProductCanvas, title: string, now: string): CanvasWrite {
  const clean = cleanLine(title, TITLE_MAX);
  if (!clean) return refuse("blank", "Give the canvas a name.");
  return finish({ ...canvas, title: clean }, canvas.sections, now);
}

/**
 * A box's lines replaced, as the section card hands them over (an add, an
 * edit, a delete or its Undo). Refused when the box isn't the format's, it
 * would hold more than its `max` (a one-line or paragraph box: one), or the
 * canvas would pass CANVAS_ITEMS_MAX lines or one row.
 */
export function withSectionItems(
  canvas: ProductCanvas,
  sectionId: string,
  items: readonly ProductCanvasItem[],
  now: string
): CanvasWrite {
  const format = formatOf(canvas);
  const def = sectionDef(format, sectionId);
  if (!def) return unknownBox(format, sectionId);
  const before = itemsOf(canvas, sectionId).length;
  const max = def.kind === "list" ? def.max : 1;
  if (items.length > max && items.length > before) return fullBox(def);
  if (itemCount(canvas) - before + items.length > CANVAS_ITEMS_MAX && items.length > before) {
    return refuse("canvas_full", CANVAS_FULL);
  }
  return finish(canvas, { ...canvas.sections, [sectionId]: [...items] }, now);
}

/** A new line in a list box. */
export interface NewItem {
  text: string;
  detail?: string;
  evidence?: ProductCanvasEvidence;
  links?: string[];
  promptId?: string;
}

/**
 * Lines added to the end of a list box, all or none. Refused for a box the
 * format doesn't have, a one-line or paragraph box (set it with
 * `withText`), a blank or too long line, or when they don't all fit the box
 * and the canvas. A line's extra fields are kept only where the box takes
 * them. `makeId` mints each line's id.
 */
export function withItems(
  canvas: ProductCanvas,
  sectionId: string,
  items: readonly NewItem[],
  now: string,
  makeId: () => string = newItemId
): CanvasWrite & { ids?: string[] } {
  const format = formatOf(canvas);
  const def = sectionDef(format, sectionId);
  if (!def) return unknownBox(format, sectionId);
  if (def.kind !== "list") {
    return refuse("not_a_list", `"${def.label}" holds one answer, not a list of lines.`);
  }
  const current = itemsOf(canvas, sectionId);
  const fresh: ProductCanvasItem[] = [];
  for (const raw of items) {
    const text = oneLine(raw.text);
    if (!text) return refuse("blank", "Write the line first.");
    if (text.length > ITEM_MAX) {
      return refuse("too_long", `Keep each line to ${ITEM_MAX} characters.`);
    }
    const item: ProductCanvasItem = { id: makeId(), text };
    const detail = raw.detail?.trim();
    if (detail) item.detail = cutText(detail, DETAIL_MAX);
    if (raw.evidence) item.evidence = raw.evidence;
    if (raw.links && raw.links.length > 0) item.links = [...raw.links];
    if (raw.promptId) item.promptId = raw.promptId;
    fresh.push(item);
  }
  if (current.length + fresh.length > def.max) {
    const room = roomLeft(def, current);
    return refuse(
      "section_full",
      room === 0
        ? `"${def.label}" is full: it holds ${def.max}.`
        : `"${def.label}" has room for ${room} more ${room === 1 ? "line" : "lines"}.`
    );
  }
  if (itemCount(canvas) + fresh.length > CANVAS_ITEMS_MAX) {
    return refuse("canvas_full", CANVAS_FULL);
  }
  const done = finish(canvas, { ...canvas.sections, [sectionId]: [...current, ...fresh] }, now);
  return done.ok ? { ...done, ids: fresh.map((i) => i.id) } : done;
}

/** One line added to the end of a list box (see `withItems`). */
export function withItem(
  canvas: ProductCanvas,
  sectionId: string,
  item: NewItem,
  now: string,
  makeId: () => string = newItemId
): CanvasWrite & { ids?: string[] } {
  return withItems(canvas, sectionId, [item], now, makeId);
}

/** The canvas without one line (lines that linked to it lose the link: see `linkersOf`). */
export function withoutItem(canvas: ProductCanvas, itemId: string, now: string): CanvasWrite {
  const found = findItem(canvas, itemId);
  if (!found) return refuse("not_found", "That line isn't on the canvas any more.");
  return finish(
    canvas,
    {
      ...canvas.sections,
      [found.def.id]: itemsOf(canvas, found.def.id).filter((i) => i.id !== itemId),
    },
    now
  );
}

/**
 * A line that links to another, with all its links as they were: what a
 * delete's Undo needs to link it again. Deleting a line drops every link
 * to it (`readSections`), so the delete records these first.
 */
export interface LinkerLine {
  itemId: string;
  links: readonly string[];
}

/** The lines on a canvas that link to `targetId`, each with its links as they are now. */
export function linkersOf(canvas: ProductCanvas, targetId: string): LinkerLine[] {
  const out: LinkerLine[] = [];
  for (const items of Object.values(canvas.sections)) {
    for (const i of items) {
      if (i.links?.includes(targetId)) out.push({ itemId: i.id, links: [...i.links] });
    }
  }
  return out;
}

/**
 * The links a delete took away, put back once its Undo has brought
 * `targetId` back: each line in `linkers` still on the canvas links to it
 * again, in the place it had among its links (links added since stay, after
 * them). Nothing changes for a target that isn't back, a line gone since,
 * one that links to it already, or one already holding LINKS_MAX links;
 * with nothing to put back, the canvas is returned as it is.
 */
export function withLinksRestored(
  canvas: ProductCanvas,
  targetId: string,
  linkers: readonly LinkerLine[],
  now: string
): CanvasWrite {
  if (!findItem(canvas, targetId)) return { ok: true, canvas };
  const sections: Sections<ProductCanvasItem> = { ...canvas.sections };
  let changed = false;
  for (const linker of linkers) {
    const found = findItem(canvas, linker.itemId);
    if (!found) continue;
    const box = found.def.id;
    const line = sections[box].find((i) => i.id === linker.itemId);
    const current = line?.links ?? [];
    if (!line || current.includes(targetId) || current.length >= LINKS_MAX) continue;
    const keep = new Set([...current, targetId]);
    const links = [
      ...linker.links.filter((l) => keep.has(l)),
      ...current.filter((l) => !linker.links.includes(l)),
    ];
    sections[box] = sections[box].map((i) => (i.id === linker.itemId ? { ...i, links } : i));
    changed = true;
  }
  return changed ? finish(canvas, sections, now) : { ok: true, canvas };
}

/** What can change on one line; `null` clears an answer or a mark. */
export interface ItemPatch {
  text?: string;
  detail?: string | null;
  evidence?: ProductCanvasEvidence | null;
  links?: string[];
  niceToHave?: boolean;
  sentTo?: HandoffLink[];
}

/**
 * One line changed. Refused when the line isn't there, the new text is
 * blank or too long or for a one-line or paragraph box (`not_a_list`: set
 * those with `withText`), or a field doesn't belong to its box: a fact or guess
 * mark outside an evidence box, an answer outside a question list, links
 * from a box that has none or to lines that aren't in the boxes it links
 * to.
 */
export function withItemPatch(
  canvas: ProductCanvas,
  itemId: string,
  patch: ItemPatch,
  now: string
): CanvasWrite {
  const found = findItem(canvas, itemId);
  if (!found) return refuse("not_found", "That line isn't on the canvas any more.");
  const { def, item } = found;
  const next: ProductCanvasItem = { ...item };
  if (patch.text !== undefined) {
    // A one-line or paragraph box's words are set as the box (withText,
    // set_field), where its own checks run: a launch date must be a day.
    if (def.kind !== "list") {
      return refuse(
        "not_a_list",
        `"${def.label}" holds one answer, not a list of lines: set the box itself.`
      );
    }
    const text = oneLine(patch.text);
    if (!text) return refuse("blank", "Write the line first.");
    if (text.length > textMaxOf(def)) {
      return refuse("too_long", `Keep it to ${textMaxOf(def)} characters.`);
    }
    next.text = text;
  }
  if (patch.evidence !== undefined) {
    if (!def.evidence) {
      return refuse("bad_field", `"${def.label}" doesn't mark lines as facts or guesses.`);
    }
    if (patch.evidence === null) delete next.evidence;
    else next.evidence = patch.evidence;
  }
  if (patch.detail !== undefined) {
    if (!def.qa) return refuse("bad_field", `"${def.label}" holds no answers.`);
    const detail = patch.detail === null ? "" : cleanPara(patch.detail, Infinity);
    if (detail.length > DETAIL_MAX) {
      return refuse("too_long", `Keep the answer to ${DETAIL_MAX} characters.`);
    }
    if (detail) next.detail = detail;
    else delete next.detail;
  }
  if (patch.links !== undefined) {
    if (!def.linksTo) return refuse("bad_field", `Lines in "${def.label}" don't link to others.`);
    const ok = linkTargets(def, idsBySection(canvas.sections));
    const links = Array.from(new Set(patch.links));
    if (links.length > LINKS_MAX || links.some((l) => !ok.has(l))) {
      const names = def.linksTo
        .map((s) => sectionDef(formatOf(canvas), s)?.label ?? s)
        .map((l) => `"${l}"`)
        .join(" or ");
      return refuse("bad_field", `A line in "${def.label}" links only to lines in ${names}.`);
    }
    if (links.length > 0) next.links = links;
    else delete next.links;
  }
  if (patch.niceToHave !== undefined) {
    if (!def.niceToHave) {
      return refuse("bad_field", `Lines in "${def.label}" aren't marked nice to have.`);
    }
    if (patch.niceToHave) next.niceToHave = true;
    else delete next.niceToHave;
  }
  if (patch.sentTo !== undefined) {
    const sentTo = cleanSentTo(patch.sentTo);
    if (sentTo) next.sentTo = sentTo;
    else delete next.sentTo;
  }
  return finish(
    canvas,
    {
      ...canvas.sections,
      [def.id]: itemsOf(canvas, def.id).map((i) => (i.id === itemId ? next : i)),
    },
    now
  );
}

/**
 * A one-line or paragraph box set (its line keeps its id and marks) or, with
 * blank text or null, cleared. Refused for a list box or one the format
 * doesn't have, and for text over the box's cap.
 */
export function withText(
  canvas: ProductCanvas,
  sectionId: string,
  text: string | null,
  now: string,
  makeId: () => string = newItemId
): CanvasWrite {
  const format = formatOf(canvas);
  const def = sectionDef(format, sectionId);
  if (!def) return unknownBox(format, sectionId);
  if (def.kind === "list") {
    return refuse("not_an_answer", `"${def.label}" is a list: add lines to it instead.`);
  }
  const clean =
    text === null ? "" : def.kind === "long" ? cleanPara(text, Infinity) : oneLine(text);
  if (clean.length > textMaxOf(def)) {
    return refuse("too_long", `Keep "${def.label}" to ${textMaxOf(def)} characters.`);
  }
  const current = itemsOf(canvas, sectionId)[0];
  const items: ProductCanvasItem[] = !clean
    ? []
    : current
      ? [{ ...current, text: clean }]
      : [{ id: makeId(), text: clean }];
  if (!current && items.length > 0 && itemCount(canvas) + 1 > CANVAS_ITEMS_MAX) {
    return refuse("canvas_full", CANVAS_FULL);
  }
  return finish(canvas, { ...canvas.sections, [sectionId]: items }, now);
}

/** A drafted line the person accepted, with the answer a question list takes. */
export interface AcceptedLine extends DraftLine {
  detail?: string;
}

/**
 * Accepted draft lines added through the kit's `addDraftLines` (never
 * over typed text), each marked a guess in an evidence box and keeping its
 * answer in a question list. Lines past the canvas's room are left out and
 * counted in `skipped`, with those the kit found no room for. `added` says
 * where each went, for Undo (`removeDraftLines`).
 */
export function withDraftLines(
  canvas: ProductCanvas,
  accepted: readonly AcceptedLine[],
  now: string,
  makeId: () => string = newItemId
): { write: CanvasWrite; added: AddedLine[]; skipped: number } {
  const format = formatOf(canvas);
  const result = addDraftLines(canvas.sections, accepted, makeId, format);
  let room = CANVAS_ITEMS_MAX - itemCount(canvas);
  const kept: AddedLine[] = [];
  let skipped = result.skipped;
  for (const a of result.added) {
    if (room > 0) {
      kept.push(a);
      room--;
    } else skipped++;
  }
  const keptIds = new Set(kept.map((a) => a.itemId));
  const addedIds = new Set(result.added.map((a) => a.itemId));
  const details = new Map<string, string>();
  for (const line of accepted) {
    if (line.detail?.trim())
      details.set(`${line.sectionId}\u0000${lineKey(line.text)}`, line.detail);
  }
  const sections: Sections<ProductCanvasItem> = {};
  for (const [sectionId, items] of Object.entries(result.sections)) {
    const def = sectionDef(format, sectionId);
    sections[sectionId] = items.flatMap((item) => {
      if (!addedIds.has(item.id)) return [item];
      if (!keptIds.has(item.id)) return [];
      const next: ProductCanvasItem = { ...item };
      if (def?.evidence) next.evidence = "assumption";
      const detail = details.get(`${sectionId}\u0000${lineKey(item.text)}`);
      if (def?.qa && detail) next.detail = cutText(detail.trim(), DETAIL_MAX);
      return [next];
    });
  }
  if (kept.length === 0) {
    return { write: { ok: true, canvas }, added: [], skipped };
  }
  return { write: finish(canvas, sections, now), added: kept, skipped };
}

/* ── Checks for forms and Amr ─────────────────────────────────────── */

/** A new canvas's name: something, within the cap. */
export function validateCanvasTitle(title: string): Validation<string, "title"> {
  const clean = oneLine(title);
  if (!clean) return { ok: false, errors: { title: "Give the canvas a name." } };
  if (clean.length > TITLE_MAX) {
    return { ok: false, errors: { title: `Keep the name to ${TITLE_MAX} characters.` } };
  }
  return { ok: true, values: clean };
}

/** A line for a box: something, within the box's cap. */
export function validateItem(text: string, def: ProductSectionDef): Validation<string, "text"> {
  const clean = def.kind === "long" ? text.replace(/\r\n?/g, "\n").trim() : oneLine(text);
  if (!clean) return { ok: false, errors: { text: "Write the line first." } };
  if (clean.length > textMaxOf(def)) {
    return { ok: false, errors: { text: `Keep it to ${textMaxOf(def)} characters.` } };
  }
  return { ok: true, values: clean };
}

/**
 * A PR/FAQ's launch date: blank (no date yet) or a real day. A day typed
 * now must be today or later; a stored day that has since passed is kept,
 * and the check flags it.
 */
export function validateLaunchDate(
  text: string,
  today: string,
  opts: { typed?: boolean } = {}
): Validation<string, "date"> {
  const clean = text.trim();
  if (!clean) return { ok: true, values: "" };
  if (!isIsoDay(clean)) {
    return { ok: false, errors: { date: "Write the date as YYYY-MM-DD, such as 2027-03-01." } };
  }
  if (opts.typed && clean < today) {
    return { ok: false, errors: { date: "Pick a day still ahead: a launch date can't be past." } };
  }
  return { ok: true, values: clean };
}

/* ── Vision Board: the pitch ──────────────────────────────────────── */

export interface PitchParts {
  name: string;
  who: string;
  need: string;
  benefit: string;
  today: string;
  difference: string;
}

/** The pitch's six boxes on a Vision Board. */
export function pitchOf(canvas: ProductCanvas): PitchParts {
  return {
    name: answerOf(canvas, "pitch-name"),
    who: answerOf(canvas, "pitch-who"),
    need: answerOf(canvas, "pitch-need"),
    benefit: answerOf(canvas, "pitch-benefit"),
    today: answerOf(canvas, "pitch-today"),
    difference: answerOf(canvas, "pitch-difference"),
  };
}

/** A word starting with a capital then a small letter ("Stall", not "SMEs"), or the word "A". */
const CAPITAL_WORD = new RegExp("^(?:\\p{Lu}\\p{Ll}|A\\s)", "u");
/** A run with a letter or a digit in any script. */
const WORDISH = new RegExp("[\\p{L}\\p{N}]", "u");

/** A box's words for the middle of a sentence: no closing stop, and "Stall holders" as "stall holders". */
function midSentence(text: string): string {
  const t = oneLine(text).replace(/[.!?;:,]+$/, "");
  return CAPITAL_WORD.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The pitch as two sentences, in our own shape: "{name} helps {who}
 * {benefit} when they {need}. Today they get by with {today}; {name} is
 * different because {difference}." An empty box drops its clause; "" when
 * nothing is filled.
 */
export function pitchSentence(parts: PitchParts): string {
  const name = oneLine(parts.name).replace(/[.!?;:,]+$/, "");
  const who = midSentence(parts.who);
  const need = midSentence(parts.need);
  const benefit = midSentence(parts.benefit);
  const today = midSentence(parts.today);
  const difference = midSentence(parts.difference);
  const sentences: string[] = [];
  if (who || benefit || need) {
    let s = `${name || "It"} helps ${who || "people"}`;
    if (benefit) s += ` ${benefit}`;
    if (need) s += ` when they ${need}`;
    sentences.push(`${s}.`);
  }
  const second: string[] = [];
  if (today) second.push(`today they get by with ${today}`);
  if (difference) second.push(`${name || "it"} is different because ${difference}`);
  if (second.length > 0) sentences.push(`${capital(second.join("; "))}.`);
  return sentences.join(" ");
}

/** The words of `list` that `text` uses, each once, in the list's order. */
function wordsFrom(text: string, list: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return list.filter((w) => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]/g, "[\\s-]");
    return new RegExp(`(?<![\\p{L}\\p{N}-])${escaped}(?![\\p{L}\\p{N}-])`, "u").test(lower);
  });
}

/** The jargon in a text ("seamless", "best-in-class"), each word once. */
export const jargonIn = (text: string): string[] => wordsFrom(text, JARGON_WORDS);

/** The feature words in a text ("app", "dashboard"), each once. */
export const featureWordsIn = (text: string): string[] => wordsFrom(text, FEATURE_WORDS);

/** Words in a text: runs with a letter or digit. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => WORDISH.test(w)).length;
}

/* ── Value Proposition: the fit meter ─────────────────────────────── */

export interface FitMeter {
  pains: { eased: number; total: number };
  gains: { added: number; total: number };
  /** Pains nothing eases, by id. */
  uneased: string[];
  /** Eases and gain-adders that link to nothing. */
  idle: number;
  /** Eased pains that are known: marked a fact, or validated in the Hypothesis Tracker. */
  confirmed: number;
}

/** What the fit meter always says beside its numbers. */
export const FIT_NOTE = "Fit is a guess until customers tell you.";

type HypothesisRow = Pick<Hypothesis, "id" | "status">;

/** Whether a line was tested and the test said yes. */
const validated = (item: ProductCanvasItem, hypotheses: readonly HypothesisRow[] | undefined) => {
  const test = linkedTest(item.sentTo, hypotheses);
  return test.state === "tested" && test.result === "validated";
};

/** How well a Value Proposition's offer side meets its customer side. */
export function fitMeter(canvas: ProductCanvas, hypotheses?: readonly HypothesisRow[]): FitMeter {
  const pains = itemsOf(canvas, "pains");
  const gains = itemsOf(canvas, "gains");
  const eases = itemsOf(canvas, "eases");
  const adds = itemsOf(canvas, "adds");
  const eased = new Set(eases.flatMap((i) => i.links ?? []));
  const added = new Set(adds.flatMap((i) => i.links ?? []));
  const easedPains = pains.filter((p) => eased.has(p.id));
  return {
    pains: { eased: easedPains.length, total: pains.length },
    gains: { added: gains.filter((g) => added.has(g.id)).length, total: gains.length },
    uneased: pains.filter((p) => !eased.has(p.id)).map((p) => p.id),
    idle: [...eases, ...adds].filter((i) => !i.links?.length).length,
    confirmed: easedPains.filter((p) => p.evidence === "fact" || validated(p, hypotheses)).length,
  };
}

/** The fit meter as one line, for Markdown and Amr. */
export function fitLine(m: FitMeter): string {
  const parts = [`${m.pains.eased} of ${m.pains.total} pains eased`];
  parts.push(`${m.gains.added} of ${m.gains.total} gains added`);
  if (m.confirmed > 0)
    parts.push(`${m.confirmed} eased ${m.confirmed === 1 ? "pain" : "pains"} confirmed`);
  if (m.idle > 0)
    parts.push(`${m.idle} offer ${m.idle === 1 ? "line" : "lines"} linked to nothing`);
  return `${parts.join(", ")}. ${FIT_NOTE}`;
}

/* ── Lean UX: hypotheses ──────────────────────────────────────────── */

/** The four boxes a Lean UX hypothesis is built from, in its sentence's order. */
export const HYPOTHESIS_PARTS = ["users", "benefits", "solutions", "outcomes"] as const;
export type HypothesisPart = (typeof HYPOTHESIS_PARTS)[number];

export interface HypothesisPicks {
  users?: ProductCanvasItem;
  benefits?: ProductCanvasItem;
  solutions?: ProductCanvasItem;
  outcomes?: ProductCanvasItem;
}

/**
 * A Lean UX hypothesis in our own shape: "{users} will {benefit} with
 * {solution}, and we'll see {outcome}."
 */
export function hypothesisSentence(p: {
  users: string;
  benefit: string;
  solution: string;
  outcome: string;
}): string {
  const users = oneLine(p.users).replace(/[.!?;:,]+$/, "");
  return `${capital(users)} will ${midSentence(p.benefit)} with ${midSentence(p.solution)}, and we'll see ${midSentence(p.outcome)}.`;
}

/** A hypothesis line's four picks, by the boxes its links point into. */
export function hypothesisPicks(canvas: ProductCanvas, item: ProductCanvasItem): HypothesisPicks {
  const out: HypothesisPicks = {};
  for (const part of HYPOTHESIS_PARTS) {
    const hit = itemsOf(canvas, part).find((i) => item.links?.includes(i.id));
    if (hit) out[part] = hit;
  }
  return out;
}

/** The first line in `sectionId` that links to `itemId`. */
export function lineLinkedTo(
  canvas: ProductCanvas,
  sectionId: string,
  itemId: string
): ProductCanvasItem | undefined {
  return itemsOf(canvas, sectionId).find((i) => i.links?.includes(itemId));
}

/**
 * A hypothesis built from one outcome, one user, one benefit and one
 * solution (their ids), added to the hypotheses box with the four picks as
 * its links. Refused when a pick is missing or the same hypothesis is
 * already there.
 */
export function withHypothesis(
  canvas: ProductCanvas,
  picks: Record<HypothesisPart, string>,
  now: string,
  makeId: () => string = newItemId
): CanvasWrite & { ids?: string[] } {
  const items: Partial<Record<HypothesisPart, ProductCanvasItem>> = {};
  for (const part of HYPOTHESIS_PARTS) {
    const hit = itemsOf(canvas, part).find((i) => i.id === picks[part]);
    if (!hit || !hit.text.trim()) {
      return refuse("blank", "Pick one outcome, one user, one benefit and one solution.");
    }
    items[part] = hit;
  }
  const text = hypothesisSentence({
    users: items.users!.text,
    benefit: items.benefits!.text,
    solution: items.solutions!.text,
    outcome: items.outcomes!.text,
  });
  if (text.length > ITEM_MAX) {
    return refuse(
      "too_long",
      `That hypothesis runs to ${text.length} characters, and a line holds ${ITEM_MAX}. Shorten one of its parts.`
    );
  }
  if (itemsOf(canvas, "hypotheses").some((i) => lineKey(i.text) === lineKey(text))) {
    return refuse("bad_field", "That hypothesis is already on the canvas.");
  }
  return withItems(
    canvas,
    "hypotheses",
    [{ text, links: HYPOTHESIS_PARTS.map((p) => items[p]!.id) }],
    now,
    makeId
  );
}

/* ── PR/FAQ: words and hard questions ─────────────────────────────── */

export interface ReleaseWords {
  /** Words in the press release, every box together. */
  words: number;
  headline: number;
}

export function releaseWords(canvas: ProductCanvas): ReleaseWords {
  return {
    words: PRESS_RELEASE_SECTIONS.reduce((n, id) => n + wordCount(answerOf(canvas, id)), 0),
    headline: wordCount(answerOf(canvas, "headline")),
  };
}

export interface HardQuestionState {
  id: string;
  text: string;
  /** An internal question with its id is on the canvas. */
  asked: boolean;
  /** And it has an answer. */
  answered: boolean;
}

/** Each hard question: asked when an internal question names it, answered when that one has its answer. */
export function hardQuestions(canvas: ProductCanvas): HardQuestionState[] {
  const lines = itemsOf(canvas, "internal-faq");
  return HARD_QUESTIONS.map((q) => {
    const asking = lines.filter((i) => i.promptId === q.id);
    return {
      id: q.id,
      text: q.text,
      asked: asking.length > 0,
      answered: asking.some((i) => Boolean(i.detail?.trim())),
    };
  });
}

/* ── Gaps: what a canvas still lacks, with no AI ──────────────────── */

/**
 * A canvas as the gap rules read it, so the page's Check panel and the
 * gaps task's answer without AI (which gets only this much) say the same.
 */
export interface GapLine {
  text: string;
  evidence?: ProductCanvasEvidence;
  /**
   * Tied to the line that completes it: an ease or a gain-adder links to
   * something, a pain or a gain has something easing or adding it, a
   * hypothesis has a smallest test, a learn-first or a test links to a
   * hypothesis.
   */
  linked: boolean;
  /** Settled: a question has its answer, a guess was tested, a hypothesis is in the tracker. */
  answered: boolean;
  /** The hard question an internal question asks. */
  asks?: string;
}

export interface GapView {
  format: ProductCanvasFormat;
  /** The one-line and paragraph boxes that hold something, by id. */
  fields: Record<string, string>;
  /** The list boxes that hold lines, by id. */
  lists: Record<string, GapLine[]>;
  goal?: { statement: string; why: string };
  /** YYYY-MM-DD, for the launch date. */
  today?: string;
}

/** One thing a canvas still lacks: in a box, or about the whole canvas. */
export interface CanvasGap {
  sectionId?: string;
  text: string;
}

export interface GapContext {
  goal?: { statement: string; why?: string } | null;
  hypotheses?: readonly HypothesisRow[];
  today?: string;
}

/** A canvas as the gap rules read it (see `GapView`). */
export function gapViewOf(canvas: ProductCanvas, ctx: GapContext = {}): GapView {
  const format = formatOf(canvas);
  const fields: Record<string, string> = {};
  const lists: Record<string, GapLine[]> = {};
  const linkedTo = new Set<string>();
  for (const def of format.sections) {
    if (def.id === "eases" || def.id === "adds") {
      for (const i of itemsOf(canvas, def.id)) i.links?.forEach((l) => linkedTo.add(l));
    }
  }
  for (const def of format.sections) {
    const items = itemsOf(canvas, def.id);
    if (def.kind !== "list") {
      const text = items[0]?.text.trim();
      if (text) fields[def.id] = text;
      continue;
    }
    if (items.length === 0) continue;
    lists[def.id] = items.map((item) => {
      const test = linkedTest(item.sentTo, ctx.hypotheses);
      const line: GapLine = {
        text: item.text,
        linked:
          def.id === "pains" || def.id === "gains"
            ? linkedTo.has(item.id)
            : def.id === "hypotheses"
              ? Boolean(lineLinkedTo(canvas, "smallest-test", item.id))
              : Boolean(item.links?.length),
        answered: def.qa
          ? Boolean(item.detail?.trim())
          : def.id === "hypotheses"
            ? test.state !== "none"
            : test.state === "tested",
      };
      if (item.evidence) line.evidence = item.evidence;
      if (item.promptId) line.asks = item.promptId;
      return line;
    });
  }
  const view: GapView = { format: canvas.format, fields, lists };
  const statement = ctx.goal?.statement.trim();
  if (statement) view.goal = { statement, why: ctx.goal?.why?.trim() ?? "" };
  if (ctx.today) view.today = ctx.today;
  return view;
}

const short = (text: string, max = 50) => {
  const t = oneLine(text);
  return t.length > max ? `${cutText(t, max - 1).trimEnd()}…` : t;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The gap rules, all in our own words, over a canvas as `GapView` holds it:
 * - every format: a required box left empty, a [placeholder] left in a
 *   line, an evidence box that is all untested guesses, and (with a goal
 *   and three lines or more) a canvas that shares no word with the goal;
 * - Vision Board: a long vision, a feature in it, too many groups, gains
 *   with no number, jargon in the pitch;
 * - Value Proposition: pains nothing eases, offer lines linked to nothing;
 * - Lean UX: a hypothesis with no smallest test, or not yet sent;
 * - PR/FAQ: the launch date missing or past, a long release or headline,
 *   hard questions not asked or not answered.
 */
export function gapsOf(view: GapView): CanvasGap[] {
  const format = productFormat(view.format);
  if (!format) return [];
  const out: CanvasGap[] = [];
  const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const field = (id: string) => (has(view.fields, id) ? view.fields[id] : "");
  const list = (id: string) => (has(view.lists, id) ? view.lists[id] : []);

  for (const def of format.sections) {
    const empty = def.kind === "list" ? list(def.id).every((l) => !l.text.trim()) : !field(def.id);
    if (def.required && empty) out.push({ sectionId: def.id, text: `"${def.label}" is empty.` });
    const texts = def.kind === "list" ? list(def.id).map((l) => l.text) : [field(def.id)];
    const held = texts.filter((t) => hasPlaceholder(t)).length;
    if (held > 0) {
      out.push({
        sectionId: def.id,
        text:
          held === 1
            ? `A line in "${def.label}" still has a [placeholder] to fill in.`
            : `${held} lines in "${def.label}" still have a [placeholder] to fill in.`,
      });
    }
    if (def.evidence && def.kind === "list") {
      const lines = list(def.id).filter((l) => l.text.trim());
      if (lines.length > 0 && lines.every((l) => l.evidence !== "fact" && !l.answered)) {
        out.push({
          sectionId: def.id,
          text: `Everything in "${def.label}" is still a guess. Test one, or mark what you know as a fact.`,
        });
      }
    }
  }

  if (view.goal) {
    const all = [
      ...Object.values(view.fields),
      ...Object.values(view.lists).flatMap((l) => l.map((x) => x.text)),
    ].filter((t) => t.trim());
    const goalWords = new Set(cardWords(`${view.goal.statement} ${view.goal.why}`).map(stem));
    if (all.length >= 3 && goalWords.size > 0) {
      const shared = all.some((t) => cardWords(t).some((w) => goalWords.has(stem(w))));
      if (!shared) {
        out.push({
          text: "Nothing here uses the Product Goal's words. Check that this canvas serves the goal.",
        });
      }
    }
  }

  if (view.format === "vision-board") {
    const vision = field("vision");
    const words = wordCount(vision);
    if (words > VISION_WORDS_MAX) {
      out.push({
        sectionId: "vision",
        text: `The vision runs to ${words} words. Say it in ${VISION_WORDS_MAX} or fewer.`,
      });
    }
    const features = featureWordsIn(vision);
    if (features.length > 0) {
      out.push({
        sectionId: "vision",
        text: `The vision names a feature ("${features[0]}"). Say what changes for people instead.`,
      });
    }
    const groups = list("who").filter((l) => l.text.trim()).length;
    if (groups > VISION_GROUPS_MAX) {
      out.push({
        sectionId: "who",
        text: `"Who it's for" names ${groups} groups. Pick the ${VISION_GROUPS_MAX} that matter most.`,
      });
    }
    const gains = list("gains").filter((l) => l.text.trim());
    if (gains.length > 0 && !gains.some((l) => /[\d%]/.test(l.text))) {
      out.push({
        sectionId: "gains",
        text: `No line in "What we get from it" has a number. Add one you can measure.`,
      });
    }
    const pitch = [
      "pitch-name",
      "pitch-who",
      "pitch-need",
      "pitch-benefit",
      "pitch-today",
      "pitch-difference",
    ]
      .map(field)
      .join(" ");
    const jargon = jargonIn(pitch);
    if (jargon.length > 0) {
      out.push({
        sectionId: "pitch-difference",
        text: `The pitch says "${jargon[0]}". Say plainly what changes instead.`,
      });
    }
  }

  if (view.format === "value-proposition") {
    const pains = list("pains").filter((l) => l.text.trim());
    const uneased = pains.filter((l) => !l.linked).length;
    if (uneased > 0) {
      out.push({
        sectionId: "eases",
        text: `${plural(uneased, "pain has", "pains have")} nothing that eases ${uneased === 1 ? "it" : "them"}.`,
      });
    }
    const idle = [...list("eases"), ...list("adds")].filter((l) => !l.linked).length;
    if (idle > 0) {
      out.push({
        sectionId: "eases",
        text: `${plural(idle, "line")} on the offer side ${idle === 1 ? "links" : "link"} to no pain or gain.`,
      });
    }
  }

  if (view.format === "lean-ux") {
    for (const h of list("hypotheses")) {
      if (!h.linked) {
        out.push({
          sectionId: "smallest-test",
          text: `"${short(h.text)}" has no smallest test yet.`,
        });
      }
      if (!h.answered) {
        out.push({
          sectionId: "hypotheses",
          text: `"${short(h.text)}" isn't in the Hypothesis Tracker yet.`,
        });
      }
    }
  }

  if (view.format === "pr-faq") {
    const date = field("launch-date");
    if (!date) {
      out.push({ sectionId: "launch-date", text: "The press release has no launch date." });
    } else if (!isIsoDay(date)) {
      out.push({ sectionId: "launch-date", text: "The launch date isn't a day (YYYY-MM-DD)." });
    } else if (view.today && date < view.today) {
      out.push({
        sectionId: "launch-date",
        text: `The launch date ${date} has passed. Move it, or say what launched.`,
      });
    }
    const words = PRESS_RELEASE_SECTIONS.reduce((n, id) => n + wordCount(field(id)), 0);
    if (words > RELEASE_WORDS_NOTE) {
      out.push({ text: `The press release runs to ${words} words. Aim for about 500.` });
    }
    const headline = wordCount(field("headline"));
    if (headline > HEADLINE_WORDS_MAX) {
      out.push({
        sectionId: "headline",
        text: `The headline has ${headline} words. Keep it to ${HEADLINE_WORDS_MAX} or fewer.`,
      });
    }
    const internal = list("internal-faq");
    const asked = HARD_QUESTIONS.filter((q) => internal.some((l) => l.asks === q.id));
    const unasked = HARD_QUESTIONS.length - asked.length;
    if (unasked > 0) {
      out.push({
        sectionId: "internal-faq",
        text: `${plural(unasked, "hard question")} ${unasked === 1 ? "isn't" : "aren't"} asked yet. Add ${unasked === 1 ? "it" : "them"} to the internal questions.`,
      });
    }
    const unanswered = asked.filter(
      (q) => !internal.some((l) => l.asks === q.id && l.answered)
    ).length;
    if (unanswered > 0) {
      out.push({
        sectionId: "internal-faq",
        text: `${plural(unanswered, "hard question")} ${unanswered === 1 ? "has" : "have"} no answer yet.`,
      });
    }
  }
  return out;
}

/** What a canvas still lacks, with no AI: the page's Check panel. */
export function canvasGaps(canvas: ProductCanvas, ctx: GapContext = {}): CanvasGap[] {
  return gapsOf(gapViewOf(canvas, ctx));
}

/* ── The CRUD's write guard ───────────────────────────────────────── */

const FORMAT_FIELDS = ["appetiteWeeks", "intake", "decision", "bet"] as const;

/**
 * The reasons a write through the workspace CRUD would lose something the
 * next time the page saves the canvas, in plain sentences; empty when the
 * page would keep it as written. The CRUD's schema already holds the caps
 * every format shares; this adds the format's own rules: the same format
 * as before, only the format's boxes, each within its `max` and its text
 * cap, the product fields only where a box takes them, links to lines that
 * are there, unique line ids, and no field the format doesn't use.
 *
 * A canvas in one of the entity's formats this build doesn't offer yet
 * (the idea inbox, the business case, the Shape Up pitch: P2.3b's) passes
 * as it is: the page leaves such a row alone, so nothing of it is lost,
 * and P2.3b's catalog checks it once the page offers the format.
 */
export function productCanvasWriteProblems(
  next: ProductCanvas,
  current: ProductCanvas | null | undefined
): string[] {
  const out: string[] = [];
  if (current && next.format !== current.format) {
    const name = productFormat(next.format)?.name ?? next.format;
    out.push(`A canvas keeps its format. Make a new ${name} canvas instead.`);
    return out;
  }
  const format = productFormat(next.format);
  if (!format) {
    if (!(PRODUCT_CANVAS_FORMATS as readonly string[]).includes(next.format)) {
      out.push(`"${next.format}" isn't a Product Canvas format.`);
    }
    return out;
  }
  for (const field of FORMAT_FIELDS) {
    if (next[field] !== undefined) out.push(`A ${format.name} has no ${field}.`);
  }
  const sections = isRecord(next.sections) ? next.sections : {};
  const ids = new Set<string>();
  const known = new Map<string, Set<string>>();
  for (const [sectionId, items] of Object.entries(sections)) {
    if (Array.isArray(items)) {
      known.set(
        sectionId,
        new Set(items.flatMap((i) => (isRecord(i) && typeof i.id === "string" ? [i.id] : [])))
      );
    }
  }
  for (const [sectionId, items] of Object.entries(sections)) {
    const def = sectionDef(format, sectionId);
    if (!def) {
      out.push(`A ${format.name} has no box called "${sectionId}".`);
      continue;
    }
    if (!Array.isArray(items)) continue;
    const max = def.kind === "list" ? def.max : 1;
    if (items.length > max) {
      out.push(
        def.kind === "list"
          ? `"${def.label}" holds ${def.max} lines at most; this write has ${items.length}.`
          : `"${def.label}" holds one answer; this write has ${items.length}.`
      );
    }
    const targets = linkTargets(def, known);
    for (const raw of items) {
      if (!isRecord(raw)) continue;
      const item = raw as unknown as ProductCanvasItem;
      if (ids.has(item.id)) out.push(`Two lines share the id "${item.id}".`);
      ids.add(item.id);
      if (typeof item.text === "string" && item.text.length > textMaxOf(def)) {
        out.push(`A line in "${def.label}" is over ${textMaxOf(def)} characters.`);
      }
      if (item.evidence !== undefined && !def.evidence) {
        out.push(`"${def.label}" doesn't mark lines as facts or guesses.`);
      }
      if (item.detail !== undefined && !def.qa) out.push(`"${def.label}" holds no answers.`);
      if (item.promptId !== undefined && !(def.hardQuestions && isHardQuestionId(item.promptId))) {
        out.push(`A line in "${def.label}" names a hard question it can't ask.`);
      }
      if (item.niceToHave !== undefined && !def.niceToHave) {
        out.push(`Lines in "${def.label}" aren't marked nice to have.`);
      }
      if (item.links !== undefined) {
        if (!def.linksTo) out.push(`Lines in "${def.label}" don't link to others.`);
        else if (item.links.some((l) => !targets.has(l))) {
          out.push(`A line in "${def.label}" links to a line that isn't there.`);
        }
      }
    }
  }
  const total = Object.values(sections).reduce(
    (n, items) => n + (Array.isArray(items) ? items.length : 0),
    0
  );
  if (total > CANVAS_ITEMS_MAX) {
    out.push(`A canvas holds ${CANVAS_ITEMS_MAX} lines in all; this write has ${total}.`);
  }
  return Array.from(new Set(out));
}

/* ── For the page and Amr ─────────────────────────────────────────── */

/** Lines a person can send on: theirs (not the example's), with no [placeholder] left. */
export function canSend(canvas: ProductCanvas, item: ProductCanvasItem): boolean {
  return !isExampleId(canvas.id) && Boolean(item.text.trim()) && !hasPlaceholder(item.text);
}

/** A guess worth testing: a line in an evidence box not marked a fact. */
export function isGuess(def: ProductSectionDef, item: ProductCanvasItem): boolean {
  return Boolean(def.evidence) && item.evidence !== "fact";
}

/** The box the Open questions go in. */
export { QUESTIONS_SECTION };
