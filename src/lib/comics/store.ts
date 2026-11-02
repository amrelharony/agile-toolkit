/**
 * The ONE public read of comic stories. Pages and feeds go through here, so
 * the release rule lives in one place: nothing leaves this file unless its
 * release_at has passed. The early reads at the end are the only exception, and
 * only /comics/early and the /vip hub call them, after checking VIP access.
 *
 * It uses the service role because the table is closed to everyone else (see
 * migration 0029). It deliberately avoids lib/supabase-server: reading cookies
 * there would force every comic page to render per request.
 *
 * On failure it THROWS at runtime. supabase-js returns { error } rather than
 * throwing, and a page that swallowed that would render empty and replace the
 * last good copy in the ISR cache. Thrown, Next keeps serving that copy during
 * a Supabase outage. Only the build returns empty, since CI builds against
 * placeholder.supabase.co; the pages it prerenders then refresh at runtime.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSquadAdminClient } from "@/lib/squads/server";
import { NO_EXTRAS, pickableTool, readQuiz, type StoryExtras } from "./extras";
import type {
  ComicCollection,
  DialogueLine,
  Panel,
  Story,
  StoryCover,
  StorySummary,
  StudyCard,
} from "./types";

/** Well under Vercel's limit, and short enough to give up and keep the last copy. */
const READ_TIMEOUT_MS = 5_000;

const STORY_COLUMNS =
  "ep,collection,title,lesson,squad_question,cast_names,themes,panels,share_path,book_page,release_at,updated_at";
/** The first panel only: a gallery card has no business carrying the whole story. */
const SUMMARY_COLUMNS = "ep,title,lesson,cast_names,themes,cover:panels->0,release_at,updated_at";

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Whole minutes, so the several reads of one render share a query string. The
 * page's revalidate period sets how fresh a story can be.
 */
function releasedBefore(): string {
  return new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
}

async function read<T>(
  empty: T,
  query: (client: SupabaseClient, now: string, signal: AbortSignal) => PromiseLike<QueryResult<T>>
): Promise<T> {
  try {
    const client = getSquadAdminClient();
    if (!client) throw new Error("comics: the service role client is not configured");
    const { data, error } = await query(
      client,
      releasedBefore(),
      AbortSignal.timeout(READ_TIMEOUT_MS)
    );
    if (error) throw new Error(`comics: read failed: ${error.message}`);
    return data ?? empty;
  } catch (err) {
    if (isBuildPhase()) return empty;
    throw err;
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

function toDialogue(raw: unknown): DialogueLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d: { speaker?: unknown; line?: unknown } | null) =>
    d && isString(d.speaker) && isString(d.line) ? [{ speaker: d.speaker, line: d.line }] : []
  );
}

function toCover(raw: unknown): StoryCover | null {
  const p = raw as { pathSmall?: unknown; width?: unknown; height?: unknown } | null;
  if (!p || !isString(p.pathSmall)) return null;
  if (typeof p.width !== "number" || typeof p.height !== "number") return null;
  return { pathSmall: p.pathSmall, width: p.width, height: p.height };
}

/** A panel missing its art is dropped rather than shown as a broken image. */
function toPanels(raw: unknown): Panel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: Record<string, unknown> | null) => {
    const cover = toCover(p);
    if (!p || !cover || !isString(p.pathFull)) return [];
    return [
      {
        ...cover,
        pathFull: p.pathFull,
        alt: isString(p.alt) ? p.alt : "",
        dialogue: toDialogue(p.dialogue),
        signs: strings(p.signs),
      },
    ];
  });
}

interface StoryRow {
  ep: number;
  collection: ComicCollection;
  title: string;
  lesson: string;
  squad_question: string;
  cast_names: unknown;
  themes: unknown;
  panels: unknown;
  share_path: string | null;
  book_page: number | null;
  release_at: string;
  updated_at: string;
}

function toStory(row: StoryRow): Story {
  return {
    ep: row.ep,
    collection: row.collection,
    title: row.title,
    lesson: row.lesson,
    squadQuestion: row.squad_question,
    castNames: strings(row.cast_names),
    themes: strings(row.themes),
    panels: toPanels(row.panels),
    sharePath: row.share_path,
    bookPage: row.book_page,
    releaseAt: row.release_at,
    updatedAt: row.updated_at,
  };
}

/** A released story, or null for a draft, an unreleased number or an unknown one. */
export async function getReleasedStory(ep: number): Promise<Story | null> {
  const row = await read<StoryRow | null>(null, (client, now, signal) =>
    client
      .from("comic_stories")
      .select(STORY_COLUMNS)
      .eq("ep", ep)
      .lte("release_at", now)
      .abortSignal(signal)
      .maybeSingle<StoryRow>()
  );
  return row ? toStory(row) : null;
}

interface SummaryRow {
  ep: number;
  title: string;
  lesson: string;
  cast_names: unknown;
  themes: unknown;
  cover: unknown;
  release_at: string;
  updated_at: string;
}

function toSummary(row: SummaryRow): StorySummary {
  return {
    ep: row.ep,
    title: row.title,
    lesson: row.lesson,
    castNames: strings(row.cast_names),
    themes: strings(row.themes),
    cover: toCover(row.cover),
    releaseAt: row.release_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A released story's quiz and own tool (migration 0033). Unlike the reads here,
 * a failure is "none": they're extras, and until that migration runs the
 * columns don't exist at all. The story read on the same page still throws in
 * an outage, and that's what keeps the page's last good copy.
 */
export async function getStoryExtras(ep: number): Promise<StoryExtras> {
  try {
    const row = await read<{ quiz: unknown; try_tool: unknown } | null>(
      null,
      (client, now, signal) =>
        client
          .from("comic_stories")
          .select("quiz,try_tool")
          .eq("ep", ep)
          .lte("release_at", now)
          .abortSignal(signal)
          .maybeSingle<{ quiz: unknown; try_tool: unknown }>()
    );
    if (!row) return NO_EXTRAS;
    const tryTool =
      typeof row.try_tool === "string" && pickableTool(row.try_tool) ? row.try_tool : null;
    return { quiz: readQuiz(row.quiz), tryTool };
  } catch {
    return NO_EXTRAS;
  }
}

/** Released weekly stories, newest first. The book stays out by design. */
export async function listReleasedWeekly(limit?: number): Promise<StorySummary[]> {
  const rows = await read<SummaryRow[]>([], (client, now, signal) => {
    const query = client
      .from("comic_stories")
      .select(SUMMARY_COLUMNS)
      .eq("collection", "weekly")
      .lte("release_at", now)
      .order("release_at", { ascending: false })
      .order("ep", { ascending: false });
    return (limit ? query.limit(limit) : query).abortSignal(signal).returns<SummaryRow[]>();
  });
  return rows.map(toSummary);
}

/** What a flashcard needs of a released weekly story, oldest first. */
export async function listStudyCards(): Promise<StudyCard[]> {
  const rows = await read<{ ep: number; title: string; lesson: string; squad_question: string }[]>(
    [],
    (client, now, signal) =>
      client
        .from("comic_stories")
        .select("ep,title,lesson,squad_question")
        .eq("collection", "weekly")
        .lte("release_at", now)
        .order("ep", { ascending: true })
        .abortSignal(signal)
  );
  return rows.map((row) => ({
    ep: row.ep,
    title: row.title,
    lesson: row.lesson,
    question: row.squad_question,
  }));
}

/** Released episode numbers in a collection, lowest first. */
export async function listReleasedEps(collection: ComicCollection): Promise<number[]> {
  const rows = await read<{ ep: number }[]>([], (client, now, signal) =>
    client
      .from("comic_stories")
      .select("ep")
      .eq("collection", collection)
      .lte("release_at", now)
      .order("ep", { ascending: true })
      .abortSignal(signal)
      .returns<{ ep: number }[]>()
  );
  return rows.map((row) => row.ep);
}

/** How far ahead book readers can see: the next four Mondays. */
export const EARLY_WINDOW_DAYS = 28;
const DAY_MS = 86_400_000;

/**
 * How long a book reader keeps a weekly story here after it comes out. No refresh
 * runs at release_at, so for up to this long the public page can still be the
 * cached "coming soon", and sending a reader there would lose the story. It's the
 * `revalidate` of the public comic pages, which Next needs written there as a plain
 * number: test/vip/early-comics.test.tsx keeps the two equal.
 */
export const EARLY_RELEASE_GRACE_SECONDS = 600;

function earlyUntil(now: string): string {
  return new Date(Date.parse(now) + EARLY_WINDOW_DAYS * DAY_MS).toISOString();
}

function earlySince(now: string): string {
  return new Date(Date.parse(now) - EARLY_RELEASE_GRACE_SECONDS * 1000).toISOString();
}

/**
 * For VIP pages only: weekly stories scheduled within the window, soonest first,
 * along with any that only just came out. A draft has no release_at, so neither
 * bound can match it, and a story further ahead stays out of reach.
 */
export async function listEarlyWeekly(): Promise<StorySummary[]> {
  const rows = await read<SummaryRow[]>([], (client, now, signal) =>
    client
      .from("comic_stories")
      .select(SUMMARY_COLUMNS)
      .eq("collection", "weekly")
      .gt("release_at", earlySince(now))
      .lte("release_at", earlyUntil(now))
      .order("release_at", { ascending: true })
      .order("ep", { ascending: true })
      .abortSignal(signal)
      .returns<SummaryRow[]>()
  );
  return rows.map(toSummary);
}

export type EarlyLookup =
  | { status: "early"; story: Story }
  /** It's out, and the public page has had time to say so: that's its home now. */
  | { status: "released" }
  /** A draft, too far ahead, or no such number: all the same to the reader. */
  | { status: "none" };

/** For VIP pages only: one story by number, within the same window. */
export async function getEarlyStory(ep: number): Promise<EarlyLookup> {
  const row = await read<StoryRow | null>(null, (client, now, signal) =>
    client
      .from("comic_stories")
      .select(STORY_COLUMNS)
      .eq("ep", ep)
      .lte("release_at", earlyUntil(now))
      .abortSignal(signal)
      .maybeSingle<StoryRow>()
  );
  if (!row) return { status: "none" };
  const now = releasedBefore();
  const releaseAt = Date.parse(row.release_at);
  // A book episode's page has the book's words whether or not its art is out yet,
  // so only a weekly story needs the grace period.
  if (row.collection !== "weekly") {
    return releaseAt <= Date.parse(now) ? { status: "released" } : { status: "none" };
  }
  return releaseAt <= Date.parse(earlySince(now))
    ? { status: "released" }
    : { status: "early", story: toStory(row) };
}
