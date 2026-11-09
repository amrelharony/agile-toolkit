/**
 * GET /api/comics/insights: everything the owner's Insights tab works from.
 * Sums the database works out of the anonymous weekly totals (migration 0036):
 * each story's per metric and time band, all time and over its first four
 * weeks (comic_story_insight_totals), and every story's per week for the trend
 * (comic_story_weekly_totals). Then the guess and "Seen this at work?" totals
 * (comic_story_taps, 0035), and each weekly story's title, themes, cast,
 * release, guess answer and shortlist mark. The figures are worked out in the
 * browser (lib/comics/insights). There is nothing about a reader to return.
 *
 * Errors: 401/403 not the owner, 503 service_unavailable | insights_unavailable
 * (migration 0036 not applied).
 */

import { readGuess } from "@/lib/comics/guess";
import type { InsightStory, TapRow, TotalRow, WeekRow } from "@/lib/comics/insights";
import { allRows, answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

type StoryRow = {
  ep: number;
  title: string;
  themes: string[] | null;
  cast_names: string[] | null;
  release_at: string | null;
  guess: unknown;
  print_shortlist: boolean | null;
};

type Paged<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

/** What the database says when a column, table or function of 0036 isn't there yet. */
const NOT_MIGRATED = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST205"]);
const unavailable = (error: { code?: string } | null | undefined) =>
  refuse(
    503,
    error?.code && NOT_MIGRATED.has(error.code) ? "insights_unavailable" : "service_unavailable"
  );

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

export const GET = ownerRoute(async ({ admin }) => {
  const { data: rows, error } = await admin
    .from("comic_stories")
    .select("ep,title,themes,cast_names,release_at,guess,print_shortlist")
    .eq("collection", "weekly")
    .order("ep", { ascending: true })
    .returns<StoryRow[]>();
  if (error) return unavailable(error);

  let failure: { code?: string } | null = null;
  const remember = (err: unknown) => {
    failure = (err as { code?: string } | null) ?? {};
  };

  const totals = await allRows<TotalRow>(
    (from, to) =>
      admin
        .rpc("comic_story_insight_totals")
        .order("ep", { ascending: true })
        .order("scope", { ascending: true })
        .order("metric", { ascending: true })
        .order("bucket", { ascending: true })
        .range(from, to) as unknown as Paged<TotalRow>,
    (r) => `${r.ep}|${r.scope}|${r.metric}|${r.bucket}`,
    remember
  );
  if (!totals) return unavailable(failure);

  const weeks = await allRows<WeekRow>(
    (from, to) =>
      admin
        .rpc("comic_story_weekly_totals")
        .order("week", { ascending: true })
        .order("metric", { ascending: true })
        .range(from, to) as unknown as Paged<WeekRow>,
    (r) => `${r.week}|${r.metric}`,
    remember
  );
  if (!weeks) return unavailable(failure);

  const taps = await allRows<TapRow>(
    (from, to) =>
      admin
        .from("comic_story_taps")
        .select("ep,kind,choice,count")
        .order("ep", { ascending: true })
        .order("kind", { ascending: true })
        .order("choice", { ascending: true })
        .range(from, to)
        .returns<TapRow[]>(),
    (r) => `${r.ep}|${r.kind}|${r.choice}`
  );
  if (!taps) return refuse(503, "service_unavailable");

  const stories: InsightStory[] = (rows ?? []).map((r) => ({
    ep: r.ep,
    title: r.title,
    themes: strings(r.themes),
    castNames: strings(r.cast_names),
    releaseAt: r.release_at,
    happened: readGuess(r.guess)?.happened ?? null,
    shortlisted: r.print_shortlist === true,
  }));
  const counted = <T extends { count: number }>(list: T[]) =>
    list.map((r) => ({ ...r, count: Number(r.count) || 0 }));
  return answer({ stories, totals: counted(totals), weeks: counted(weeks), taps: counted(taps) });
});
