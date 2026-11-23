/**
 * Kickoff's model: reading a stored kickoff, its writes, what's still open,
 * the trade-off sliders, the problem statement, the drafted lines, and what
 * a line takes with it when it is sent on.
 *
 * A kickoff is a workspace row (`Kickoff`): a format from the catalog
 * (./formats), its sections (the sectioned kit's items, with a worry's
 * ratings and the worry a line covers), and for Inception and Trade-offs the
 * sliders. The page, Amr's verbs and the next steps all read rows through
 * `normalizeKickoff`, so a synced or hand-written row can't break them.
 *
 * Store writes stamp nothing: the writers here stamp `updatedAt` for a
 * change to the words, and leave it for a change to where a line was sent,
 * so "Changed since you agreed" means the words changed.
 *
 * Pure and server-safe: no zod, no React, no store, no "use client" imports.
 */

import { nanoid } from "nanoid";
import type { HandoffSource } from "@/lib/handoffs/types";
import {
  SECTION_ITEM_ID_MAX,
  addDraftLines,
  cleanSections,
  draftLinesFor,
  hasPlaceholder,
  isBlankItem,
  lineKey,
  roomLeft,
  sectionGaps,
  type AddedLine,
  type DraftLine,
  type SectionFormat,
  type Sections,
} from "@/lib/sectioned/model";
import {
  ENTITY_ROW_MAX_BYTES,
  HANDOFF_ROUTE_IDS,
  KICKOFF_BRIEF_MAX,
  KICKOFF_ITEM_MAX,
  KICKOFF_SLIDER_LABEL_MAX,
  KICKOFF_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HandoffRouteId,
  type Kickoff,
  type KickoffFormat,
  type KickoffItem,
  type KickoffSlider,
  type KickoffStatus,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { cutText } from "@/lib/utils/cut-text";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  DEFAULT_SLIDERS,
  KICKOFF_FORMAT_DEFS,
  PEOPLE_SECTION,
  kickoffFormat,
  type KickoffFormatDef,
  type KickoffSectionDef,
} from "./formats";

/** The tool a kickoff's sends name in their `sourceRef`. */
const KICKOFF_TOOL = "kickoff";

/** A drafted line's most characters (the AI's cap, under the item cap). */
export const KICKOFF_DRAFT_LINE_MAX = 200;

/** Why a write was refused: the row would pass the database's cap. */
export const KICKOFF_TOO_BIG =
  "This kickoff is too big to save. Shorten or remove some lines. Nothing was saved.";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One line, trimmed: line breaks and runs of spaces become one space. */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Text cut to `max` characters, ending in "…" when it was cut. */
export function cutLine(text: string, max: number): string {
  const t = oneLine(text);
  return t.length > max ? `${cutText(t, max - 1).trimEnd()}…` : t;
}

/** A short form of a line for a sentence or a button's name. */
export const shortText = (text: string, max = 48): string => cutLine(text, max);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "16 Nov 2026" for a day or a time; "" for anything else. A day
 * ("YYYY-MM-DD") is that calendar day; a time (an agreed kickoff's
 * `agreedAt`) is its day where the reader is, so the page and the export
 * say the same day.
 */
export function dayLabel(value: string | undefined): string {
  if (!value) return "";
  const day = DAY.test(value);
  const d = new Date(day ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(day ? { timeZone: "UTC" } : {}),
  });
}

/* ── Ids ─────────────────────────────────────────────────────────── */

/** A new kickoff's id, as the CRUD makes them. */
export const newKickoffId = (): string => `kickoff_${nanoid(8)}`;
/** A new line's or slider's id. */
export const newKickoffItemId = (): string => nanoid(8);

/* ── Reading ─────────────────────────────────────────────────────── */

/** A rating on the 1–5 scale, or undefined. */
export function toRating(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : undefined;
}

const ROUTES: ReadonlySet<string> = new Set(HANDOFF_ROUTE_IDS);

/** Valid hand-off links only, one per route (the last wins); undefined when none. */
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

/**
 * A line as its section takes it: ratings only where the section rates, an
 * owner only where it has one, and the worry it covers only where its
 * section covers. That worry's id stays while the worry is missing: a
 * deleted worry's Undo (or any write made before it) finds the lines that
 * covered it still pointing at it. The views look the worry up
 * (`coveredWorry`, `coveringItems`), so an id that points at nothing shows
 * nothing.
 */
function cleanItem(item: KickoffItem, def: KickoffSectionDef): KickoffItem {
  const { likelihood, impact, owner, covers, ...rest } = item;
  const next: KickoffItem = { ...rest };
  if (def.owner && owner) next.owner = owner;
  if (def.covers && typeof covers === "string" && covers && covers.length <= SECTION_ITEM_ID_MAX) {
    next.covers = covers;
  }
  if (def.ratings) {
    const l = toRating(likelihood);
    const i = toRating(impact);
    if (l !== undefined) next.likelihood = l;
    if (i !== undefined) next.impact = i;
  }
  return next;
}

/** The sliders read safely: labels kept once (case ignored), positions 1, 2, 3… in their order. */
export function cleanSliders(raw: unknown): KickoffSlider[] {
  if (!Array.isArray(raw)) return [];
  const rows: (KickoffSlider & { index: number })[] = [];
  raw.forEach((s, index) => {
    if (!isRecord(s)) return;
    const { id, label, position, note } = s;
    if (typeof id !== "string" || !id || id.length > 64) return;
    if (typeof label !== "string") return;
    const text = cutText(oneLine(label), KICKOFF_SLIDER_LABEL_MAX).trim();
    if (!text) return;
    const n = typeof note === "string" ? cutText(note.trim(), TOOL_TEXT_MAX.short).trim() : "";
    rows.push({
      id,
      label: text,
      position: typeof position === "number" && Number.isFinite(position) ? position : Infinity,
      ...(n ? { note: n } : {}),
      index,
    });
  });
  rows.sort((a, b) => a.position - b.position || a.index - b.index);
  const ids = new Set<string>();
  const labels = new Set<string>();
  const out: KickoffSlider[] = [];
  for (const row of rows) {
    const key = lineKey(row.label);
    if (ids.has(row.id) || labels.has(key)) continue;
    ids.add(row.id);
    labels.add(key);
    out.push({
      id: row.id,
      label: row.label,
      position: row.position,
      ...(row.note ? { note: row.note } : {}),
    });
    if (out.length >= TOOL_LIST_MAX.kickoffSliders) break;
  }
  return out.map((s, i) => ({ ...s, position: i + 1 }));
}

function cleanParticipants(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string") continue;
    const name = cutText(p.trim(), TOOL_TEXT_MAX.short).trim();
    const key = nameKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= TOOL_LIST_MAX.kickoffParticipants) break;
  }
  return out.length > 0 ? out : undefined;
}

const isoOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? v : undefined;

/**
 * A stored kickoff read safely, or null when it can't be one (no id, or a
 * format the catalog doesn't have). It keeps the format's sections only
 * (lib/sectioned's `cleanSections`), drops lines with neither words nor an
 * owner, ratings off the 1–5 scale, and `covers` on a line whose section
 * can't cover (a `covers` whose worry is missing stays: see `cleanItem`);
 * slider positions come out unique, 1 first, and only formats with sliders
 * keep them.
 */
export function normalizeKickoff(raw: unknown): Kickoff | null {
  if (!isRecord(raw)) return null;
  const { id, title, format } = raw;
  if (typeof id !== "string" || !id) return null;
  const def = kickoffFormat(format);
  if (!def) return null;
  const sections = cleanSections<KickoffItem>(raw.sections, def, {
    itemMax: KICKOFF_ITEM_MAX,
    longMax: KICKOFF_ITEM_MAX,
  });
  // Only the sections the row holds: a missing one reads as empty (itemsOf).
  for (const d of def.sections) {
    if (!Object.prototype.hasOwnProperty.call(sections, d.id)) continue;
    sections[d.id] = sections[d.id].map((i) => cleanItem(i, d)).filter((i) => !isBlankItem(i));
  }
  const status: KickoffStatus = (KICKOFF_STATUSES as readonly unknown[]).includes(raw.status)
    ? (raw.status as KickoffStatus)
    : "draft";
  const brief = typeof raw.brief === "string" ? cutText(raw.brief, KICKOFF_BRIEF_MAX) : "";
  const participants = cleanParticipants(raw.participants);
  const sliders = def.hasSliders ? cleanSliders(raw.sliders) : [];
  const slidersSetAt = def.hasSliders ? isoOrUndefined(raw.slidersSetAt) : undefined;
  const agreedAt = status === "agreed" ? isoOrUndefined(raw.agreedAt) : undefined;
  const sentTo = cleanLinks(raw.sentTo);
  return {
    id,
    title: typeof title === "string" ? cutText(title, TOOL_TEXT_MAX.short) : "",
    format: def.id,
    ...(brief.trim() ? { brief } : {}),
    ...(typeof raw.date === "string" && DAY.test(raw.date) ? { date: raw.date } : {}),
    ...(participants ? { participants } : {}),
    sections,
    ...(def.hasSliders ? { sliders } : {}),
    ...(slidersSetAt ? { slidersSetAt } : {}),
    status,
    ...(agreedAt ? { agreedAt } : {}),
    ...(sentTo ? { sentTo } : {}),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

/** Every readable kickoff of `rows`, newest change first. */
export function readKickoffs(rows: readonly unknown[] | undefined): Kickoff[] {
  return newestFirst((rows ?? []).flatMap((r) => normalizeKickoff(r) ?? []));
}

/** Newest change first (then newest made, then by id, so the order is stable). */
export function newestFirst(kickoffs: readonly Kickoff[]): Kickoff[] {
  return [...kickoffs].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id)
  );
}

/** The kickoff's format. */
export const formatOf = (k: Pick<Kickoff, "format">): KickoffFormatDef =>
  KICKOFF_FORMAT_DEFS[k.format];

/** A section's lines (never an inherited key like "constructor"). */
export function itemsOf(k: Pick<Kickoff, "sections">, sectionId: string): KickoffItem[] {
  return Object.prototype.hasOwnProperty.call(k.sections, sectionId)
    ? (k.sections[sectionId] ?? [])
    : [];
}

/** A line and the section it is in, or null. */
export function findItem(
  k: Kickoff,
  itemId: string
): { item: KickoffItem; def: KickoffSectionDef } | null {
  for (const def of formatOf(k).sections) {
    const item = itemsOf(k, def.id).find((i) => i.id === itemId);
    if (item) return { item, def };
  }
  return null;
}

/** How many lines the kickoff holds. */
export function itemCount(k: Kickoff): number {
  return formatOf(k).sections.reduce((n, d) => n + itemsOf(k, d.id).length, 0);
}

/** The single answer of a section, trimmed ("" when empty). */
export function answerOf(k: Kickoff, sectionId: string): string {
  return oneLine(itemsOf(k, sectionId)[0]?.text ?? "");
}

/** Whether a row fits the database's cap on one entity. */
export const fitsRow = (k: Kickoff): boolean => jsonBytes(k) <= ENTITY_ROW_MAX_BYTES;

/* ── Writes ──────────────────────────────────────────────────────── */

/** The kickoff with one section's lines replaced, stamped `now`. */
export function withSectionItems(
  k: Kickoff,
  sectionId: string,
  items: readonly KickoffItem[],
  now: string
): Kickoff {
  return { ...k, sections: { ...k.sections, [sectionId]: [...items] }, updatedAt: now };
}

/** The kickoff with one line changed. `stamp` false keeps `updatedAt` (a send's link). */
export function withItemPatch(
  k: Kickoff,
  itemId: string,
  patch: (item: KickoffItem) => KickoffItem,
  now: string,
  { stamp = true }: { stamp?: boolean } = {}
): Kickoff | null {
  const found = findItem(k, itemId);
  if (!found) return null;
  const items = itemsOf(k, found.def.id).map((i) => (i.id === itemId ? patch(i) : i));
  const next = { ...k, sections: { ...k.sections, [found.def.id]: items } };
  return stamp ? { ...next, updatedAt: now } : next;
}

/** The kickoff agreed, or back to draft. */
export function withStatus(k: Kickoff, status: KickoffStatus, now: string): Kickoff {
  if (status === "agreed") return { ...k, status, agreedAt: now, updatedAt: now };
  const { agreedAt: _agreedAt, ...rest } = k;
  void _agreedAt;
  return { ...rest, status, updatedAt: now };
}

/** Agreed, and its words changed after. */
export function changedSinceAgreed(k: Kickoff): boolean {
  return k.status === "agreed" && Boolean(k.agreedAt) && k.updatedAt.localeCompare(k.agreedAt!) > 0;
}

/* ── Starting one ────────────────────────────────────────────────── */

/** The start form's words. */
export interface KickoffDraft {
  title: string;
  brief: string;
  date: string;
  participants: readonly string[];
}

export interface KickoffStart {
  title: string;
  brief: string;
  date?: string;
  participants: string[];
}

/** The start form checked: a title, and every field within its cap. */
export function validateKickoff(
  draft: KickoffDraft
): Validation<KickoffStart, "title" | "brief" | "date" | "participants"> {
  const errors: Partial<Record<"title" | "brief" | "date" | "participants", string>> = {};
  const title = draft.title.trim();
  const brief = draft.brief.trim();
  const date = draft.date.trim();
  if (!title) errors.title = "Name the kickoff: the team or the work it starts.";
  else if (title.length > TOOL_TEXT_MAX.short) {
    errors.title = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  if (brief.length > KICKOFF_BRIEF_MAX) {
    errors.brief = `Keep the brief to ${KICKOFF_BRIEF_MAX.toLocaleString("en")} characters.`;
  }
  if (date && (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
    errors.date = "Pick a date, or leave it empty.";
  }
  if (draft.participants.length > TOOL_LIST_MAX.kickoffParticipants) {
    errors.participants = `Up to ${TOOL_LIST_MAX.kickoffParticipants} people.`;
  } else if (draft.participants.some((p) => p.trim().length > TOOL_TEXT_MAX.short)) {
    errors.participants = `Keep each name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      brief,
      ...(date ? { date } : {}),
      participants: draft.participants.map((p) => p.trim()).filter(Boolean),
    },
  };
}

/**
 * The Team Canvas's people from the roster: each real member (examples
 * left out) as a line, owner = the name, text = the role (or empty), up to
 * the section's room.
 */
export function peopleFromRoster(
  roster: readonly TeamMember[],
  makeId: () => string = newKickoffItemId
): KickoffItem[] {
  const def = KICKOFF_FORMAT_DEFS["team-canvas"].sections.find((d) => d.id === PEOPLE_SECTION)!;
  const seen = new Set<string>();
  const out: KickoffItem[] = [];
  for (const m of roster) {
    if (isExampleId(m.id)) continue;
    const name = cutText(oneLine(m.name ?? ""), TOOL_TEXT_MAX.short).trim();
    if (!name || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push({
      id: makeId(),
      text: cutText(oneLine(m.role ?? ""), KICKOFF_ITEM_MAX),
      owner: name,
    });
    if (out.length >= def.max) break;
  }
  return out;
}

/** The default sliders (Scope, Date, Cost, Quality), in that order. */
export function defaultSliders(makeId: () => string = newKickoffItemId): KickoffSlider[] {
  return DEFAULT_SLIDERS.map((label, i) => ({ id: makeId(), label, position: i + 1 }));
}

/**
 * A new kickoff, stamped `now`: a Team Canvas starts with the roster's
 * people, an Inception deck or Trade-offs with the default sliders.
 */
export function blankKickoff(opts: {
  id: string;
  format: KickoffFormat;
  title: string;
  brief?: string;
  date?: string;
  participants?: readonly string[];
  roster?: readonly TeamMember[];
  now: string;
  makeId?: () => string;
}): Kickoff {
  const def = KICKOFF_FORMAT_DEFS[opts.format];
  const makeId = opts.makeId ?? newKickoffItemId;
  const sections: Record<string, KickoffItem[]> = {};
  for (const d of def.sections) sections[d.id] = [];
  if (opts.format === "team-canvas" && opts.roster) {
    sections[PEOPLE_SECTION] = peopleFromRoster(opts.roster, makeId);
  }
  const brief = (opts.brief ?? "").trim();
  const participants = cleanParticipants(opts.participants ?? []);
  return {
    id: opts.id,
    title: cutText(opts.title.trim(), TOOL_TEXT_MAX.short),
    format: opts.format,
    ...(brief ? { brief: cutText(brief, KICKOFF_BRIEF_MAX) } : {}),
    ...(opts.date && DAY.test(opts.date) ? { date: opts.date } : {}),
    ...(participants ? { participants } : {}),
    sections,
    ...(def.hasSliders ? { sliders: defaultSliders(makeId) } : {}),
    status: "draft",
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/* ── Worries and what covers them ────────────────────────────────── */

/** Each worry (a line of a section whose lines are worries), with its section. */
export function worriesOf(k: Kickoff): { item: KickoffItem; def: KickoffSectionDef }[] {
  return formatOf(k).sections.flatMap((def) =>
    def.coverTarget ? itemsOf(k, def.id).map((item) => ({ item, def })) : []
  );
}

/** The lines that cover a worry, in the format's order. */
export function coveringItems(
  k: Kickoff,
  worryId: string
): { item: KickoffItem; def: KickoffSectionDef }[] {
  return formatOf(k).sections.flatMap((def) =>
    def.covers
      ? itemsOf(k, def.id).flatMap((item) => (item.covers === worryId ? [{ item, def }] : []))
      : []
  );
}

/**
 * The worry a line covers, with its section; null when it covers none, or
 * its worry isn't in the kickoff (deleted, and maybe on its way back with
 * Undo).
 */
export function coveredWorry(
  k: Kickoff,
  item: KickoffItem
): { item: KickoffItem; def: KickoffSectionDef } | null {
  if (!item.covers) return null;
  return worriesOf(k).find((w) => w.item.id === item.covers) ?? null;
}

/** The sections whose lines can cover this kickoff's worries. */
export function coverSections(k: Kickoff): KickoffSectionDef[] {
  return formatOf(k).sections.filter((d) => d.covers);
}

/** Both ratings set. */
export const isRated = (item: KickoffItem): boolean =>
  toRating(item.likelihood) !== undefined && toRating(item.impact) !== undefined;

/* ── What's still open ───────────────────────────────────────────── */

export interface KickoffGap {
  /** Stable, for keys and tests. */
  id: string;
  /** One plain sentence. */
  text: string;
  sectionId?: string;
  itemId?: string;
}

/** Owner sections whose lines need an owner to count: commitments and needs. */
const NEEDS_OWNER = new Set(["commitments", "needs"]);

/**
 * What the kickoff still lacks, with no AI, in this order: required
 * sections left empty and lines still holding a [placeholder] (the kit's
 * `sectionGaps`), worries not rated or not covered, commitments or needs
 * with no owner, people with no role, and sliders whose order was never set.
 */
export function kickoffGaps(k: Kickoff): KickoffGap[] {
  const format = formatOf(k);
  const label = (id: string) => format.sections.find((d) => d.id === id)?.label ?? id;
  const out: KickoffGap[] = [];
  for (const g of sectionGaps(format, k.sections)) {
    const def = format.sections.find((d) => d.id === g.sectionId);
    if (g.kind === "empty") {
      out.push({
        id: `empty:${g.sectionId}`,
        text: def?.emptyNote ?? `“${label(g.sectionId)}” is still empty.`,
        sectionId: g.sectionId,
      });
    } else {
      out.push({
        id: `placeholder:${g.sectionId}:${g.itemId}`,
        text: `A line in “${label(g.sectionId)}” still has [brackets] to fill in.`,
        sectionId: g.sectionId,
        itemId: g.itemId,
      });
    }
  }
  for (const { item, def } of worriesOf(k)) {
    const words = shortText(item.text);
    if (!isRated(item)) {
      out.push({
        id: `unrated:${def.id}:${item.id}`,
        text: `Rate how likely “${words}” is, and how bad it would be.`,
        sectionId: def.id,
        itemId: item.id,
      });
    }
    if (coveringItems(k, item.id).length === 0) {
      out.push({
        id: `uncovered:${def.id}:${item.id}`,
        text: `Nothing covers “${words}” yet.`,
        sectionId: def.id,
        itemId: item.id,
      });
    }
  }
  for (const def of format.sections) {
    if (!def.owner) continue;
    for (const item of itemsOf(k, def.id)) {
      if (def.id === PEOPLE_SECTION) {
        if (item.owner && !item.text.trim()) {
          out.push({
            id: `role:${item.id}`,
            text: `${shortText(item.owner)} has no role yet.`,
            sectionId: def.id,
            itemId: item.id,
          });
        }
      } else if (NEEDS_OWNER.has(def.id) && !item.owner?.trim()) {
        out.push({
          id: `owner:${def.id}:${item.id}`,
          text: `“${shortText(item.text)}” in “${def.label}” has no owner.`,
          sectionId: def.id,
          itemId: item.id,
        });
      }
    }
  }
  if (format.hasSliders && !k.slidersSetAt) {
    out.push({ id: "sliders", text: "Put the trade-offs in order: nobody has set it yet." });
  }
  return out;
}

/* ── Sliders ─────────────────────────────────────────────────────── */

/** The sliders from holds firm (1) to gives first. */
export function orderedSliders(k: Pick<Kickoff, "sliders">): KickoffSlider[] {
  return [...(k.sliders ?? [])].sort((a, b) => a.position - b.position);
}

const renumber = (sliders: readonly KickoffSlider[]): KickoffSlider[] =>
  sliders.map((s, i) => (s.position === i + 1 ? s : { ...s, position: i + 1 }));

/** The sliders with one moved up (-1) or down (+1); null when it can't move. */
export function moveSlider(
  sliders: readonly KickoffSlider[],
  id: string,
  delta: -1 | 1
): KickoffSlider[] | null {
  const list = [...sliders].sort((a, b) => a.position - b.position);
  const at = list.findIndex((s) => s.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= list.length) return null;
  [list[at], list[to]] = [list[to], list[at]];
  return renumber(list);
}

/** Why a slider can't be added, or null. */
export function sliderProblem(sliders: readonly KickoffSlider[], label: string): string | null {
  const text = oneLine(label);
  if (!text) return "Name the trade-off.";
  if (text.length > KICKOFF_SLIDER_LABEL_MAX) {
    return `Keep it to ${KICKOFF_SLIDER_LABEL_MAX} characters.`;
  }
  if (sliders.some((s) => lineKey(s.label) === lineKey(text)))
    return "That one is already on the list.";
  if (sliders.length >= TOOL_LIST_MAX.kickoffSliders) {
    return `The list holds ${TOOL_LIST_MAX.kickoffSliders} trade-offs.`;
  }
  return null;
}

/** The sliders with a new one at the bottom (gives first); null when it can't be added. */
export function withSlider(
  sliders: readonly KickoffSlider[],
  label: string,
  makeId: () => string = newKickoffItemId
): KickoffSlider[] | null {
  if (sliderProblem(sliders, label)) return null;
  const list = [...sliders].sort((a, b) => a.position - b.position);
  return renumber([...list, { id: makeId(), label: oneLine(label), position: list.length + 1 }]);
}

/** The sliders without one. */
export function withoutSlider(sliders: readonly KickoffSlider[], id: string): KickoffSlider[] {
  return renumber([...sliders].sort((a, b) => a.position - b.position).filter((s) => s.id !== id));
}

/**
 * The sliders in a given order (holds firm first), labels matched with case
 * and spacing ignored. A label not on the list is added; sliders the order
 * leaves out keep their order after it.
 */
export function withSliderOrder(
  sliders: readonly KickoffSlider[],
  order: readonly string[],
  makeId: () => string = newKickoffItemId
): { ok: true; sliders: KickoffSlider[] } | { ok: false; reason: "duplicate" | "too_many" } {
  const keys = order.map(lineKey);
  if (new Set(keys).size !== keys.length || keys.some((k) => !k)) {
    return { ok: false, reason: "duplicate" };
  }
  const byKey = new Map(sliders.map((s) => [lineKey(s.label), s]));
  const named: KickoffSlider[] = order.map(
    (label, i) =>
      byKey.get(keys[i]) ?? {
        id: makeId(),
        label: cutText(oneLine(label), KICKOFF_SLIDER_LABEL_MAX).trim(),
        position: 0,
      }
  );
  const rest = [...sliders]
    .sort((a, b) => a.position - b.position)
    .filter((s) => !keys.includes(lineKey(s.label)));
  const all = [...named, ...rest];
  if (all.length > TOOL_LIST_MAX.kickoffSliders) return { ok: false, reason: "too_many" };
  return { ok: true, sliders: renumber(all) };
}

/** "Holds firm: Date. Gives first: Scope." for the order, or "" with fewer than two. */
export function sliderSummary(k: Pick<Kickoff, "sliders">): string {
  const list = orderedSliders(k);
  if (list.length < 2) return "";
  return `Holds firm: ${list[0].label}. Gives first: ${list[list.length - 1].label}.`;
}

/** The order as one sentence for a screen reader: "Date, then Quality, then Cost, then Scope". */
export function sliderOrderText(k: Pick<Kickoff, "sliders">): string {
  return orderedSliders(k)
    .map((s) => s.label)
    .join(", then ");
}

/* ── Problem framing ─────────────────────────────────────────────── */

/** A part of a sentence: trimmed, without its closing stop, lower-cased first unless it starts with an acronym. */
function clause(text: string): string {
  const t = oneLine(text).replace(/[\s.!?;:,]+$/, "");
  if (!t) return "";
  const first = t.split(" ")[0];
  if (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** A part usable in a template: filled in, with no [placeholder] left. */
function part(k: Kickoff, sectionId: string): string {
  const text = answerOf(k, sectionId);
  return text && !hasPlaceholder(text) ? clause(text) : "";
}

/**
 * The problem statement from the answers, with a template of our own:
 * "For <who>, <what happens> (<when and where>). That costs <impact>." Null
 * until "who" and "what" are filled in.
 */
export function statementFrom(k: Kickoff): string | null {
  const who = part(k, "who");
  const what = part(k, "what");
  if (!who || !what) return null;
  const when = part(k, "when-where");
  const impact = part(k, "impact");
  const text = `For ${who}, ${what}${when ? ` (${when})` : ""}.${impact ? ` That costs ${impact}.` : ""}`;
  return cutLine(text, KICKOFF_ITEM_MAX);
}

/** Up to three "How might we…" questions from who, what, the outcome and the impact, not yet in the list. */
export function hmwStarters(k: Kickoff): string[] {
  const who = part(k, "who");
  const what = part(k, "what");
  const outcome = part(k, "outcome");
  const impact = part(k, "impact");
  const lines: string[] = [];
  if (who && outcome) lines.push(`How might we help ${who} so that ${outcome}?`);
  else if (who) lines.push(`How might we make things easier for ${who}?`);
  // What good looks like asks its own question, as the page's hint promises.
  else if (outcome) lines.push(`How might we get to this: ${outcome}?`);
  if (what) lines.push(`How might we change what happens today: ${what}?`);
  if (impact) lines.push(`How might we lower what it costs: ${impact}?`);
  const def = formatOf(k).sections.find((d) => d.id === "hmw");
  if (!def) return [];
  const have = new Set(itemsOf(k, def.id).map((i) => lineKey(i.text)));
  return lines
    .map((l) => cutLine(l, KICKOFF_DRAFT_LINE_MAX))
    .filter((l) => !have.has(lineKey(l)))
    .slice(0, Math.min(3, roomLeft(def, itemsOf(k, def.id))));
}

/* ── The team's purpose ──────────────────────────────────────────── */

/**
 * The purpose of the newest agreed Team Canvas (examples left out), for
 * the team charter and Amr; null when there is none.
 */
export function teamPurpose(
  rows: readonly unknown[] | undefined
): { kickoffId: string; text: string } | null {
  const agreed = readKickoffs(rows)
    .filter((k) => !isExampleId(k.id) && k.format === "team-canvas" && k.status === "agreed")
    .sort((a, b) => (b.agreedAt ?? b.updatedAt).localeCompare(a.agreedAt ?? a.updatedAt));
  for (const k of agreed) {
    const text = answerOf(k, "purpose");
    if (text) return { kickoffId: k.id, text };
  }
  return null;
}

/* ── Drafted lines ───────────────────────────────────────────────── */

/**
 * The format as a draft fills it: every section a list (a single answer is
 * a list of one, so a filled one is full), without the team's people, whose
 * lines are names.
 */
export function draftFormatOf(format: KickoffFormatDef): SectionFormat {
  return {
    ...format,
    sections: format.sections
      .filter((d) => d.id !== PEOPLE_SECTION)
      .map((d) => (d.kind === "list" ? d : { ...d, kind: "list" as const, max: 1 })),
  };
}

/** A drafted line as the AI task (or its fallback) answers it. */
export interface DraftedItem {
  section: string;
  text: string;
}

/**
 * Drafted lines ready to offer: lines for sections the format doesn't
 * have, for full sections (a single answer that holds one), and repeats are
 * dropped (lib/sectioned's `draftLinesFor`); `dropped` counts the ones that
 * didn't fit.
 */
export function draftItemsFor(
  format: KickoffFormatDef,
  items: readonly DraftedItem[],
  k: Pick<Kickoff, "sections">
): { lines: DraftLine[]; dropped: number } {
  return draftLinesFor(
    draftFormatOf(format),
    k.sections,
    items.map((i) => ({ sectionId: i.section, text: cutLine(i.text, KICKOFF_ITEM_MAX) }))
  );
}

/** Drafted sliders not on the list yet, cut to the room left. */
export function draftSlidersFor(k: Pick<Kickoff, "sliders">, labels: readonly string[]): string[] {
  const have = new Set((k.sliders ?? []).map((s) => lineKey(s.label)));
  const out: string[] = [];
  for (const label of labels) {
    const text = cutText(oneLine(label), KICKOFF_SLIDER_LABEL_MAX).trim();
    const key = lineKey(text);
    if (!text || have.has(key)) continue;
    have.add(key);
    out.push(text);
  }
  return out.slice(0, Math.max(0, TOOL_LIST_MAX.kickoffSliders - (k.sliders?.length ?? 0)));
}

/** Accepted lines added to the kickoff (stamped), with where each went for Undo. */
export function withDraftLines(
  k: Kickoff,
  accepted: readonly DraftLine[],
  now: string,
  makeId: () => string = newKickoffItemId
): { kickoff: Kickoff; added: AddedLine[]; skipped: number } {
  const result = addDraftLines<KickoffItem>(
    k.sections as Sections<KickoffItem>,
    accepted,
    makeId,
    draftFormatOf(formatOf(k))
  );
  if (result.added.length === 0) return { kickoff: k, added: [], skipped: result.skipped };
  return {
    kickoff: { ...k, sections: result.sections, updatedAt: now },
    added: result.added,
    skipped: result.skipped,
  };
}

/* ── Sending lines on ────────────────────────────────────────────── */

/** Why a line can't be sent yet, or null: the example, a [placeholder], no words. */
export function sendProblem(k: Kickoff, item: KickoffItem): string | null {
  if (isExampleId(k.id)) return "Example lines aren't sent anywhere.";
  if (!item.text.trim()) return "Write the line first.";
  if (hasPlaceholder(item.text)) return "Fill in the [brackets] before you send it.";
  return null;
}

/**
 * A worry (or a weakness) as a risk: its words, its two ratings, the lines
 * that cover it as the mitigation ("; " between them), and the first
 * covering line's owner. The Risk Register refuses it until both ratings
 * are set (`riskSourceProblem`).
 */
export function worryToRisk(k: Kickoff, item: KickoffItem): HandoffSource {
  const covering = coveringItems(k, item.id);
  const mitigation = covering
    .map((c) => oneLine(c.item.text))
    .filter(Boolean)
    .join("; ");
  const owner = covering.find((c) => c.def.owner && c.item.owner?.trim())?.item.owner?.trim();
  const likelihood = toRating(item.likelihood);
  const impact = toRating(item.impact);
  return {
    title: oneLine(item.text),
    ...(likelihood !== undefined ? { likelihood } : {}),
    ...(impact !== undefined ? { impact } : {}),
    ...(mitigation ? { mitigation } : {}),
    ...(owner ? { owner } : {}),
    sourceRef: { tool: KICKOFF_TOOL, id: item.id, doc: k.id },
  };
}

/** "From the kickoff “Checkout squad”." for a sent line's description. */
const fromLine = (k: Kickoff) =>
  k.title.trim() ? `From the kickoff “${shortText(k.title, 80)}”.` : "From a kickoff.";

/** A problem framing's evidence, filled-in lines only, joined with "; ". */
function evidenceOf(k: Kickoff): string {
  return itemsOf(k, "evidence")
    .map((e) => oneLine(e.text))
    .filter((e) => e && !hasPlaceholder(e))
    .join("; ");
}

/**
 * What a line takes with it to a route: a worry its ratings and cover
 * (`worryToRisk`); a problem statement its evidence (an opportunity's
 * evidence, a root-cause analysis's problem); an assumption only its words
 * (the tracker asks the rest); a story or a rule where it came from.
 */
export function itemSource(k: Kickoff, item: KickoffItem, route: HandoffRouteId): HandoffSource {
  if (route === "risk") return worryToRisk(k, item);
  const title = oneLine(item.text);
  const evidence = evidenceOf(k);
  if (route === "opportunity") {
    return {
      title,
      ...(evidence ? { description: evidence } : {}),
      sourceRef: { tool: KICKOFF_TOOL, id: item.id, doc: k.id },
    };
  }
  if (route === "root-cause") {
    return {
      title,
      description: evidence ? `${title}\n\nHow we know: ${evidence}` : title,
      sourceRef: { tool: KICKOFF_TOOL, id: item.id, doc: k.id },
    };
  }
  if (route === "hypothesis") {
    return { title, sourceRef: { tool: KICKOFF_TOOL, id: item.id, doc: k.id } };
  }
  return {
    title,
    description: fromLine(k),
    sourceRef: { tool: KICKOFF_TOOL, id: item.id, doc: k.id },
  };
}

/** The id the slider order's decision is sent under. */
export const slidersRefId = (k: Pick<Kickoff, "id">): string => `${k.id}:sliders`;

/** The slider order as a decision to record: the labels as its options, holds firm first. */
export function slidersDecisionSource(k: Kickoff): HandoffSource {
  const labels = orderedSliders(k).map((s) => s.label);
  const title = cutLine(`Trade-offs for ${k.title.trim() || "the kickoff"}`, TOOL_TEXT_MAX.short);
  return {
    title,
    description: sliderSummary(k) || "The order of the trade-offs.",
    decision: { options: labels },
    sourceRef: { tool: KICKOFF_TOOL, id: slidersRefId(k), doc: k.id },
  };
}
