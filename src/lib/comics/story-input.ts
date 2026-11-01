/**
 * What the owner may save as a story, shared by the portal's forms and its
 * routes so anything the page accepts the server accepts too. Pure.
 *
 * These are the owner's shapes: a stored panel may have no art yet and can be
 * waiting for review. lib/comics/store.ts turns them into the public `Panel`,
 * so neither of those two facts ever reaches a page.
 */

import { BOOK_EPISODE_COUNT, isBookEp } from "./entry";
import { THEME_LABELS } from "./themes";
import type { ComicCollection, DialogueLine, Panel } from "./types";

export const CREDIT_CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export type CreditCorner = (typeof CREDIT_CORNERS)[number];
export const DEFAULT_CREDIT_CORNER: CreditCorner = "bottom-right";

/** A panel as the table holds it. Empty paths mean its art isn't uploaded yet. */
export interface StoredPanel extends Panel {
  /** Text came from an import, or nobody has checked it. Survives a reload. */
  needsReview: boolean;
  /** Where the credit is drawn into the art. Only used when art is converted. */
  creditCorner: CreditCorner;
}

export interface OwnerStory {
  ep: number;
  collection: ComicCollection;
  sourceId: string | null;
  title: string;
  lesson: string;
  squadQuestion: string;
  castNames: string[];
  themes: string[];
  panels: StoredPanel[];
  sharePath: string | null;
  bookPage: number | null;
  /** Null is a draft; a future time is scheduled; a past one is released. */
  releaseAt: string | null;
  updatedAt: string;
}

/** What a create or an edit may send. Every field is optional on an edit. */
export interface StoryFields {
  sourceId: string | null;
  title: string;
  lesson: string;
  squadQuestion: string;
  castNames: string[];
  themes: string[];
  panels: StoredPanel[];
  sharePath: string | null;
  bookPage: number | null;
}

export const STORY_LIMITS = {
  sourceId: 40,
  title: 120,
  lesson: 400,
  squadQuestion: 400,
  castNames: 40,
  castName: 60,
  panels: 12,
  alt: 600,
  dialogueLines: 20,
  speaker: 60,
  line: 400,
  signs: 30,
  sign: 200,
  pixels: 10_000,
  bookPage: 2_000,
} as const;

/** Upload URLs only ever hand out these names, so nothing else can be saved. */
const ART_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|jpg)$/;

export function isArtPath(value: unknown): value is string {
  return typeof value === "string" && ART_PATH.test(value);
}

export function collectionForEp(ep: number): ComicCollection {
  return isBookEp(ep) ? "book" : "weekly";
}

export function isValidStoryEp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 999;
}

/** Postgres refuses a NUL in text, and nothing typed here needs a control character. */
function clean(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

class Refused extends Error {}

function text(value: unknown, limit: number, field: string): string {
  if (typeof value !== "string") throw new Refused(field);
  const cleaned = clean(value);
  if (cleaned.length > limit) throw new Refused(field);
  return cleaned;
}

function list(value: unknown, limit: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Refused(field);
  return value;
}

function textList(value: unknown, count: number, each: number, field: string): string[] {
  return list(value, count, field)
    .map((item) => text(item, each, field))
    .filter(Boolean);
}

function pixels(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Refused(field);
  if (value < 0 || value > STORY_LIMITS.pixels) throw new Refused(field);
  return value;
}

function artPath(value: unknown, field: string): string {
  if (value === "" || isArtPath(value)) return value;
  throw new Refused(field);
}

function dialogue(value: unknown): DialogueLine[] {
  return list(value, STORY_LIMITS.dialogueLines, "panels").flatMap((raw) => {
    const d = (raw ?? {}) as { speaker?: unknown; line?: unknown };
    const line = text(d.line, STORY_LIMITS.line, "panels");
    // A speaker can be blank; the words can't be.
    return line ? [{ speaker: text(d.speaker ?? "", STORY_LIMITS.speaker, "panels"), line }] : [];
  });
}

function storedPanel(raw: unknown): StoredPanel {
  if (!raw || typeof raw !== "object") throw new Refused("panels");
  const p = raw as Record<string, unknown>;
  const pathFull = artPath(p.pathFull ?? "", "panels");
  const pathSmall = artPath(p.pathSmall ?? "", "panels");
  // Half-uploaded art would pass the release check and show a broken image.
  if (Boolean(pathFull) !== Boolean(pathSmall)) throw new Refused("panels");
  const corner = p.creditCorner ?? DEFAULT_CREDIT_CORNER;
  if (!CREDIT_CORNERS.includes(corner as CreditCorner)) throw new Refused("panels");
  return {
    pathFull,
    pathSmall,
    width: pixels(p.width ?? 0, "panels"),
    height: pixels(p.height ?? 0, "panels"),
    alt: text(p.alt ?? "", STORY_LIMITS.alt, "panels"),
    dialogue: dialogue(p.dialogue ?? []),
    signs: textList(p.signs ?? [], STORY_LIMITS.signs, STORY_LIMITS.sign, "panels"),
    needsReview: p.needsReview === true,
    creditCorner: corner as CreditCorner,
  };
}

/**
 * Check a create or edit body of unknown shape. Only the fields present come
 * back, so an edit leaves the rest alone. Unknown keys are dropped, never saved.
 */
export function parseStoryFields(
  body: unknown
): { ok: true; fields: Partial<StoryFields> } | { ok: false; field: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "body" };
  const b = body as Record<string, unknown>;
  const fields: Partial<StoryFields> = {};
  try {
    if (b.sourceId !== undefined) {
      fields.sourceId =
        b.sourceId === null ? null : text(b.sourceId, STORY_LIMITS.sourceId, "sourceId") || null;
    }
    if (b.title !== undefined) fields.title = text(b.title, STORY_LIMITS.title, "title");
    if (b.lesson !== undefined) fields.lesson = text(b.lesson, STORY_LIMITS.lesson, "lesson");
    if (b.squadQuestion !== undefined) {
      fields.squadQuestion = text(b.squadQuestion, STORY_LIMITS.squadQuestion, "squadQuestion");
    }
    if (b.castNames !== undefined) {
      fields.castNames = textList(
        b.castNames,
        STORY_LIMITS.castNames,
        STORY_LIMITS.castName,
        "castNames"
      );
    }
    if (b.themes !== undefined) {
      const themes = list(b.themes, Object.keys(THEME_LABELS).length, "themes");
      if (!themes.every((t) => typeof t === "string" && Object.hasOwn(THEME_LABELS, t))) {
        return { ok: false, field: "themes" };
      }
      fields.themes = themes as string[];
    }
    if (b.panels !== undefined) {
      fields.panels = list(b.panels, STORY_LIMITS.panels, "panels").map(storedPanel);
    }
    if (b.sharePath !== undefined) {
      if (b.sharePath !== null && !isArtPath(b.sharePath)) return { ok: false, field: "sharePath" };
      fields.sharePath = b.sharePath;
    }
    if (b.bookPage !== undefined) {
      const page = b.bookPage;
      const valid =
        page === null ||
        (typeof page === "number" &&
          Number.isInteger(page) &&
          page >= 1 &&
          page <= STORY_LIMITS.bookPage);
      if (!valid) return { ok: false, field: "bookPage" };
      fields.bookPage = page;
    }
  } catch (err) {
    if (err instanceof Refused) return { ok: false, field: err.message };
    throw err;
  }
  return { ok: true, fields };
}

/** A time the database will store as the same instant, or null. */
export function parseReleaseAt(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function panelHasArt(panel: Pick<Panel, "pathFull" | "pathSmall">): boolean {
  return Boolean(panel.pathFull && panel.pathSmall);
}

type Releasable = Pick<OwnerStory, "title" | "panels">;

/**
 * Why a story can't be published or scheduled yet; empty when it can. A panel
 * with no description fails people who can't see the art, so it blocks too.
 */
export function publishProblems(story: Releasable): string[] {
  const problems: string[] = [];
  if (!story.title.trim()) problems.push("Add a title.");
  if (story.panels.length === 0) problems.push("Add at least one panel.");
  story.panels.forEach((panel, i) => {
    if (!panelHasArt(panel)) problems.push(`Panel ${i + 1} has no art.`);
    if (!panel.alt.trim()) problems.push(`Panel ${i + 1} has no description.`);
  });
  return problems;
}

export type StoryState = "draft" | "scheduled" | "released";

export function storyState(releaseAt: string | null, now: number = Date.now()): StoryState {
  if (!releaseAt) return "draft";
  return Date.parse(releaseAt) > now ? "scheduled" : "released";
}

/** The number a new weekly story takes: after everything, so none is reused. */
export function nextWeeklyEp(existing: readonly number[]): number {
  return Math.max(BOOK_EPISODE_COUNT, ...existing) + 1;
}

const isString = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

/** A stored panel as the owner sees it, whatever an older row holds. */
export function toStoredPanels(raw: unknown): StoredPanel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => {
    const p = (value ?? {}) as Record<string, unknown>;
    return {
      pathFull: isString(p.pathFull) ? p.pathFull : "",
      pathSmall: isString(p.pathSmall) ? p.pathSmall : "",
      width: typeof p.width === "number" ? p.width : 0,
      height: typeof p.height === "number" ? p.height : 0,
      alt: isString(p.alt) ? p.alt : "",
      dialogue: Array.isArray(p.dialogue)
        ? p.dialogue.flatMap((d: { speaker?: unknown; line?: unknown } | null) =>
            d && isString(d.line)
              ? [{ speaker: isString(d.speaker) ? d.speaker : "", line: d.line }]
              : []
          )
        : [],
      signs: strings(p.signs),
      needsReview: p.needsReview === true,
      creditCorner: CREDIT_CORNERS.includes(p.creditCorner as CreditCorner)
        ? (p.creditCorner as CreditCorner)
        : DEFAULT_CREDIT_CORNER,
    };
  });
}

export interface StoryRow {
  ep: number;
  collection: ComicCollection;
  source_id: string | null;
  title: string;
  lesson: string;
  squad_question: string;
  cast_names: unknown;
  themes: unknown;
  panels: unknown;
  share_path: string | null;
  book_page: number | null;
  release_at: string | null;
  updated_at: string;
}

export const OWNER_STORY_COLUMNS =
  "ep,collection,source_id,title,lesson,squad_question,cast_names,themes,panels,share_path,book_page,release_at,updated_at";

export function toOwnerStory(row: StoryRow): OwnerStory {
  return {
    ep: row.ep,
    collection: row.collection,
    sourceId: row.source_id,
    title: row.title,
    lesson: row.lesson,
    squadQuestion: row.squad_question,
    castNames: strings(row.cast_names),
    themes: strings(row.themes),
    panels: toStoredPanels(row.panels),
    sharePath: row.share_path,
    bookPage: row.book_page,
    releaseAt: row.release_at,
    updatedAt: row.updated_at,
  };
}

/** The columns for a validated set of fields. Absent fields stay absent. */
export function storyFieldsToRow(fields: Partial<StoryFields>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (fields.sourceId !== undefined) row.source_id = fields.sourceId;
  if (fields.title !== undefined) row.title = fields.title;
  if (fields.lesson !== undefined) row.lesson = fields.lesson;
  if (fields.squadQuestion !== undefined) row.squad_question = fields.squadQuestion;
  if (fields.castNames !== undefined) row.cast_names = fields.castNames;
  if (fields.themes !== undefined) row.themes = fields.themes;
  if (fields.panels !== undefined) row.panels = fields.panels;
  if (fields.sharePath !== undefined) row.share_path = fields.sharePath;
  if (fields.bookPage !== undefined) row.book_page = fields.bookPage;
  return row;
}
