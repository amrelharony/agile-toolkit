/**
 * The sectioned kit: documents made of named sections, each a list of lines
 * or one answer. Kickoff (six formats) and Product Canvas (seven) are built
 * on it. These are structured documents, not the whiteboard (the `canvas`
 * tool and lib/whiteboard).
 *
 * A tool describes each format as a `SectionFormat` (its own catalog, in our
 * own words) and keeps the document's lines as `Sections`: section id → the
 * items in it, each a `SectionItem` (workspace-types) or a tool's extension
 * of it. This module reads, checks and exports those documents, and filters
 * drafted lines (AI or the no-AI starter lines) before a person accepts them.
 *
 * Pure and server-safe: no zod (the CRUD's schema factory lives in
 * lib/actions/workspace/sectioned-schema.ts), no "use client" imports, so
 * Amr's MCP handlers can use it as the pages do.
 */

import {
  HANDOFF_ROUTE_IDS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HandoffRouteId,
  type SectionItem,
} from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";

/* ── Formats ──────────────────────────────────────────────────────── */

/** A section's id, and a format's: lower case, digits and dashes, at most 32 characters. */
export const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** What a section holds: lines, one short answer, or one longer answer. */
export const SECTION_KINDS = ["list", "single", "long"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Caps on a section's own words (`formatProblems` checks them). */
export const SECTION_LABEL_MAX = 60;
export const SECTION_PROMPT_MAX = 200;
export const SECTION_HINT_MAX = 200;
/** A starter line becomes an item, so it fits every tool's item cap and an AI line (200). */
export const SECTION_STARTER_MAX = 200;
/** An item's id, as the CRUD schema caps it. */
export const SECTION_ITEM_ID_MAX = 64;

/** A tool id in `links`: the registry's shape (the tool's catalog test checks the ids exist). */
const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** One section of a format. Tools extend it with their own fields (P2.3's `ProductSectionDef`). */
export interface SectionDef {
  /** SECTION_ID_PATTERN; unique in its format. */
  id: string;
  /** At most SECTION_LABEL_MAX characters, our own words. */
  label: string;
  /** What to write here, at most SECTION_PROMPT_MAX characters, our own words. */
  prompt: string;
  /** A tip under the prompt, at most SECTION_HINT_MAX characters. */
  hint?: string;
  kind: SectionKind;
  /** A list's most items, 1 to TOOL_LIST_MAX.sectionItems; a single or long answer: 1. */
  max: number;
  required: boolean;
  /** One starter line with [brackets] to fill in: the no-AI draft offers it. */
  starter?: string;
  /** Tools this section points to, by id. */
  links?: readonly string[];
}

/** Where a format comes from: shown under the document and at the end of its Markdown. */
export interface SectionCredit {
  /** "After Roman Pichler's Product Vision Board". */
  text: string;
  /** https only; any other link is never shown. */
  url?: string;
  /** What the owner cleared ("CC BY-SA 4.0"); nothing is shown when it is absent. */
  licence?: string;
}

/** A document's format: its sections in order. Tools extend it (P2.3's `layout`). */
export interface SectionFormat<S extends SectionDef = SectionDef> {
  /** SECTION_ID_PATTERN. */
  id: string;
  name: string;
  /** When to pick it, one sentence. */
  useWhen: string;
  /** How long it takes ("About 40 minutes"). */
  time?: string;
  /** The section the document starts from: one of its section ids. */
  lead: string;
  credit?: SectionCredit;
  /** 1 to TOOL_LIST_MAX.sections, ids unique. */
  sections: readonly S[];
}

/** A document's lines: section id → its items, in order. */
export type Sections<I extends SectionItem = SectionItem> = Record<string, I[]>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An own property only: a section id like "constructor" never reads Object's. */
const own = <T>(o: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;

/** One line, trimmed: line breaks and runs of spaces become one space. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const blank = (s: string | undefined) => !s || !s.trim();

/**
 * What is wrong with a format, as plain sentences; empty when it is sound.
 * Each tool's catalog test runs it over every format it ships.
 */
export function formatProblems(format: SectionFormat): string[] {
  const out: string[] = [];
  const at = `Format "${format.id}"`;
  if (!SECTION_ID_PATTERN.test(format.id)) {
    out.push(`${at}: the id must be lower case letters, digits and dashes, at most 32.`);
  }
  if (blank(format.name)) out.push(`${at}: it needs a name.`);
  if (blank(format.useWhen)) out.push(`${at}: it needs a line on when to use it.`);
  if (format.time !== undefined && blank(format.time)) out.push(`${at}: its time is empty.`);
  const count = format.sections.length;
  if (count < 1 || count > TOOL_LIST_MAX.sections) {
    out.push(`${at}: it has ${count} sections, and 1 to ${TOOL_LIST_MAX.sections} fit.`);
  }
  const ids = new Set<string>();
  for (const def of format.sections) {
    out.push(...sectionProblems(def, `${at}, section "${def.id}"`));
    if (ids.has(def.id)) out.push(`${at}: the section id "${def.id}" is used twice.`);
    ids.add(def.id);
  }
  if (!ids.has(format.lead)) {
    out.push(`${at}: its lead "${format.lead}" is not one of its sections.`);
  }
  if (format.credit) {
    const { text, url, licence } = format.credit;
    if (blank(text)) out.push(`${at}: its credit needs a line of text.`);
    if (url !== undefined && !creditUrl(format.credit)) {
      out.push(`${at}: its credit link must be an https address.`);
    }
    if (licence !== undefined && blank(licence)) out.push(`${at}: its credit's licence is empty.`);
  }
  return out;
}

function sectionProblems(def: SectionDef, at: string): string[] {
  const out: string[] = [];
  if (!SECTION_ID_PATTERN.test(def.id)) {
    out.push(`${at}: the id must be lower case letters, digits and dashes, at most 32.`);
  }
  if (blank(def.label)) out.push(`${at}: it needs a label.`);
  else if (def.label.length > SECTION_LABEL_MAX) {
    out.push(`${at}: the label is over ${SECTION_LABEL_MAX} characters.`);
  }
  if (blank(def.prompt)) out.push(`${at}: it needs a prompt.`);
  else if (def.prompt.length > SECTION_PROMPT_MAX) {
    out.push(`${at}: the prompt is over ${SECTION_PROMPT_MAX} characters.`);
  }
  if (def.hint !== undefined) {
    if (blank(def.hint)) out.push(`${at}: the hint is empty.`);
    else if (def.hint.length > SECTION_HINT_MAX) {
      out.push(`${at}: the hint is over ${SECTION_HINT_MAX} characters.`);
    }
  }
  if (!(SECTION_KINDS as readonly string[]).includes(def.kind)) {
    out.push(`${at}: the kind must be list, single or long.`);
  } else if (def.kind === "list") {
    if (!Number.isInteger(def.max) || def.max < 1 || def.max > TOOL_LIST_MAX.sectionItems) {
      out.push(`${at}: a list holds 1 to ${TOOL_LIST_MAX.sectionItems} items.`);
    }
  } else if (def.max !== 1) {
    out.push(`${at}: a ${def.kind} answer holds exactly 1 item.`);
  }
  if (typeof def.required !== "boolean") out.push(`${at}: say whether it is required.`);
  if (def.starter !== undefined) {
    if (blank(def.starter)) out.push(`${at}: the starter line is empty.`);
    else if (/[\r\n]/.test(def.starter)) out.push(`${at}: the starter is more than one line.`);
    else if (def.starter.length > SECTION_STARTER_MAX) {
      out.push(`${at}: the starter is over ${SECTION_STARTER_MAX} characters.`);
    } else if (!hasPlaceholder(def.starter)) {
      out.push(`${at}: the starter has no [brackets] to fill in.`);
    }
  }
  if (def.links) {
    const seen = new Set<string>();
    for (const id of def.links) {
      if (!TOOL_ID_PATTERN.test(id)) out.push(`${at}: "${id}" is not a tool id.`);
      else if (seen.has(id)) out.push(`${at}: it links to "${id}" twice.`);
      seen.add(id);
    }
  }
  return out;
}

/* ── Reading a document ───────────────────────────────────────────── */

const ROUTES: ReadonlySet<string> = new Set(HANDOFF_ROUTE_IDS);

/** Valid hand-off links only, one per route (the last one wins); undefined when none is left. */
function cleanLinks(raw: unknown): HandoffLink[] | undefined {
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

function cleanItem<I extends SectionItem>(raw: unknown, textMax: number): I | null {
  if (!isRecord(raw)) return null;
  const { id, text, owner, sentTo, ...rest } = raw;
  if (typeof id !== "string" || !id || id.length > SECTION_ITEM_ID_MAX) return null;
  if (typeof text !== "string") return null;
  const item: Record<string, unknown> = { id, text: cutText(text, textMax), ...rest };
  if (typeof owner === "string" && owner.trim()) item.owner = cutText(owner, TOOL_TEXT_MAX.short);
  const links = cleanLinks(sentTo);
  if (links) item.sentTo = links;
  return item as I;
}

/**
 * A stored or received document read against its format, for every read
 * and before every write:
 * - keys the format doesn't have, and values that aren't lists, are dropped;
 * - items without a string `id` (1 to 64 characters) or a string `text` are
 *   dropped;
 * - a list keeps its first `max` items; a single or long answer keeps only
 *   its first item;
 * - `text` is cut to `itemMax` (list and single) or `longMax` (long), never
 *   splitting a character; `owner` is kept when it is a non-empty string, cut
 *   to TOOL_TEXT_MAX.short; `sentTo` keeps valid links only, one per route;
 * - every other field of an item is kept as it is: the tool's own reader
 *   checks its extra fields (evidence, ratings, links).
 * Text isn't trimmed, and ids aren't de-duplicated: a tool that needs them
 * unique across the document does that itself.
 */
export function cleanSections<I extends SectionItem>(
  raw: unknown,
  format: SectionFormat,
  caps: { itemMax: number; longMax: number }
): Sections<I> {
  const out: Sections<I> = {};
  if (!isRecord(raw)) return out;
  for (const def of format.sections) {
    if (!SECTION_ID_PATTERN.test(def.id)) continue;
    const value = own(raw, def.id);
    if (!Array.isArray(value)) continue;
    const textMax = def.kind === "long" ? caps.longMax : caps.itemMax;
    const keep = def.kind === "list" ? def.max : 1;
    const items: I[] = [];
    for (const rawItem of value) {
      if (items.length >= keep) break;
      const item = cleanItem<I>(rawItem, textMax);
      if (item) items.push(item);
    }
    out[def.id] = items;
  }
  return out;
}

/** How many more items a section takes: a list up to its `max`, a single or long answer one. */
export function roomLeft(def: SectionDef, items: readonly SectionItem[] | undefined): number {
  const max = def.kind === "list" ? def.max : 1;
  return Math.max(0, max - (items?.length ?? 0));
}

/** Brackets around at least one letter or digit, on one line ("[who]", not "[ ]"). */
const PLACEHOLDER = new RegExp("\\[[^\\[\\]\\r\\n]*[\\p{L}\\p{N}][^\\[\\]\\r\\n]*\\]", "u");

/** A "[…]" still left from a starter line. */
export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/** An item that says nothing: no text and no owner. */
export function isBlankItem(item: SectionItem): boolean {
  return blank(item.text) && blank(item.owner);
}

/** What a document still lacks, with no AI: an empty required section, or a line still holding a placeholder. */
export interface SectionGap {
  sectionId: string;
  kind: "empty" | "placeholder";
  /** The line holding the placeholder. */
  itemId?: string;
}

/**
 * The no-AI half of "point out gaps", in the format's order: each required
 * section with nothing in it (only blank items counts as nothing), then each
 * line in any section that still holds a [placeholder].
 */
export function sectionGaps(format: SectionFormat, sections: Sections): SectionGap[] {
  const out: SectionGap[] = [];
  for (const def of format.sections) {
    const items = own(sections, def.id) ?? [];
    if (def.required && items.every(isBlankItem)) {
      out.push({ sectionId: def.id, kind: "empty" });
    }
    for (const item of items) {
      if (hasPlaceholder(item.text)) {
        out.push({ sectionId: def.id, kind: "placeholder", itemId: item.id });
      }
    }
  }
  return out;
}

/* ── Credit and Markdown ──────────────────────────────────────────── */

/** The credit's link when it is a valid https address; undefined otherwise. */
export function creditUrl(credit: SectionCredit | undefined): string | undefined {
  const url = credit?.url?.trim();
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The credit as plain words: its text, then the licence in brackets when there is one. */
export function creditLine(credit: SectionCredit): string {
  const text = oneLine(credit.text);
  const licence = credit.licence ? oneLine(credit.licence) : "";
  return licence ? `${text} (${licence})` : text;
}

/** An item's default Markdown line: its text, with the owner in brackets (or the owner alone). */
function defaultLine(item: SectionItem): string {
  const text = oneLine(item.text);
  const owner = item.owner ? oneLine(item.owner) : "";
  if (!text) return owner;
  return owner ? `${text} (${owner})` : text;
}

/**
 * A document as Markdown: a `##` heading per section that has something to
 * show, in the format's order; a list's items as "- " lines, a single or long
 * answer as a paragraph; then the credit line ("After …", its licence, and
 * the link) when the format has one. The tool adds its own title and
 * anything else around it.
 *
 * `itemLine` writes one item's line (without the "- "), for every kind; an
 * empty line leaves the item out. By default it is the text, with the owner
 * in brackets.
 */
export function sectionsMarkdown<I extends SectionItem, S extends SectionDef = SectionDef>(
  format: SectionFormat<S>,
  sections: Sections<I>,
  opts: { itemLine?: (item: I, def: S) => string } = {}
): string {
  const blocks: string[] = [];
  for (const def of format.sections) {
    const items = own(sections, def.id) ?? [];
    const lines: string[] = [];
    for (const item of items) {
      const raw = opts.itemLine ? opts.itemLine(item, def) : null;
      if (def.kind === "list") {
        const line = oneLine(raw ?? defaultLine(item));
        if (line) lines.push(`- ${line}`);
      } else {
        const para = (raw ?? (item.text || item.owner || "")).replace(/\r\n?/g, "\n").trim();
        if (para) lines.push(para);
      }
    }
    if (lines.length === 0) continue;
    blocks.push(
      `## ${oneLine(def.label)}`,
      def.kind === "list" ? lines.join("\n") : lines.join("\n\n")
    );
  }
  if (format.credit && !blank(format.credit.text)) {
    const url = creditUrl(format.credit);
    blocks.push(url ? `${creditLine(format.credit)} · ${url}` : creditLine(format.credit));
  }
  return blocks.join("\n\n");
}

/* ── Drafted lines ────────────────────────────────────────────────── */

/** A drafted line for one section: from the AI, or the no-AI starter lines. */
export interface DraftLine {
  sectionId: string;
  text: string;
}

/** A line's text for comparing: case and spaces don't count. */
export function lineKey(text: string): string {
  return oneLine(text).toLowerCase();
}

/**
 * The shared filter for drafted lines, before anyone sees them. It keeps
 * only lines for the format's list sections, as one trimmed line each;
 * drops blank lines, lines a section already holds (case and spaces
 * ignored) and repeats; and keeps each section to the room it has left, in
 * the order the lines came. `dropped` counts the lines that didn't fit.
 */
export function draftLinesFor(
  format: SectionFormat,
  sections: Sections,
  lines: readonly DraftLine[]
): { lines: DraftLine[]; dropped: number } {
  const lists = new Map<string, { room: number; seen: Set<string> }>();
  for (const def of format.sections) {
    if (def.kind !== "list") continue;
    const items = own(sections, def.id);
    lists.set(def.id, {
      room: roomLeft(def, items),
      seen: new Set((items ?? []).map((i) => lineKey(i.text))),
    });
  }
  const out: DraftLine[] = [];
  let dropped = 0;
  for (const line of lines) {
    const list = lists.get(line.sectionId);
    const text = oneLine(line.text);
    if (!list || !text) continue;
    const key = lineKey(text);
    if (list.seen.has(key)) continue;
    list.seen.add(key);
    if (list.room <= 0) {
      dropped++;
      continue;
    }
    list.room--;
    out.push({ sectionId: line.sectionId, text });
  }
  return { lines: out, dropped };
}

/** Where an accepted line went, so Undo takes out exactly that item. */
export interface AddedLine {
  sectionId: string;
  itemId: string;
}

/**
 * Accepted lines added as new items at the end of their sections (ids from
 * `makeId`), with where each went. Blank lines and lines the section
 * already holds are left out. It never changes an item that is there: a
 * single or long answer that holds text is replaced only through the
 * tool's own "Replace" step. Sections it doesn't touch keep their arrays.
 *
 * Pass the format: the lines were offered a while ago, and the document may
 * have changed since. With it, a line goes in only where there is room now
 * (a list below its `max`, a single or long answer that holds nothing), so
 * an accept never overflows a section that `cleanSections` would later cut
 * back, dropping the accepted lines unseen. A line for a section the format
 * doesn't have is left out too.
 *
 * `skipped` counts the lines with words that didn't go in: no room, a
 * section the format doesn't have, or an id that isn't a section id. A line
 * the section already holds isn't counted (it's there), and neither is a
 * repeat of a line that found no room. The tool can say "N lines didn't fit".
 */
export function addDraftLines<I extends SectionItem>(
  sections: Sections<I>,
  accepted: readonly DraftLine[],
  makeId: () => string,
  format?: SectionFormat
): { sections: Sections<I>; added: AddedLine[]; skipped: number } {
  const defs = format ? new Map(format.sections.map((d) => [d.id, d])) : null;
  const next: Sections<I> = { ...sections };
  const added: AddedLine[] = [];
  const seen = new Map<string, Set<string>>();
  let skipped = 0;
  for (const line of accepted) {
    const text = oneLine(line.text);
    if (!text) continue;
    const def = defs?.get(line.sectionId);
    if (!SECTION_ID_PATTERN.test(line.sectionId) || (defs && !def)) {
      skipped++;
      continue;
    }
    const current = own(next, line.sectionId) ?? [];
    let keys = seen.get(line.sectionId);
    if (!keys) {
      keys = new Set(current.map((i) => lineKey(i.text)));
      seen.set(line.sectionId, keys);
    }
    const key = lineKey(text);
    if (keys.has(key)) continue;
    keys.add(key);
    if (def && roomLeft(def, current) === 0) {
      skipped++;
      continue;
    }
    const itemId = makeId();
    next[line.sectionId] = [...current, { id: itemId, text } as I];
    added.push({ sectionId: line.sectionId, itemId });
  }
  return { sections: added.length > 0 ? next : sections, added, skipped };
}

/** The document without the items `addDraftLines` added: the Undo of an accept. Other sections keep their arrays. */
export function removeDraftLines<I extends SectionItem>(
  sections: Sections<I>,
  added: readonly AddedLine[]
): Sections<I> {
  const bySection = new Map<string, Set<string>>();
  for (const a of added) {
    const ids = bySection.get(a.sectionId) ?? new Set<string>();
    ids.add(a.itemId);
    bySection.set(a.sectionId, ids);
  }
  let next: Sections<I> | null = null;
  for (const [sectionId, ids] of Array.from(bySection)) {
    const items = own(sections, sectionId);
    if (!items || !items.some((i) => ids.has(i.id))) continue;
    next ??= { ...sections };
    next[sectionId] = items.filter((i) => !ids.has(i.id));
  }
  return next ?? sections;
}
