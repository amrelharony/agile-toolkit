/**
 * GET /api/comics/insights: everything the owner's Insights tab works from. The
 * anonymous weekly totals per story (comic_story_stats, migration 0036), the
 * guess and "Seen this at work?" totals (comic_story_taps, 0035), and each
 * weekly story's title, themes, cast, release, guess answer and shortlist mark.
 * The figures are worked out in the browser (lib/comics/insights). There is
 * nothing about a reader to return.
 *
 * Errors: 401/403 not the owner, 503 service_unavailable | insights_unavailable
 * (migration 0036 not applied).
 */

import { readGuess } from "@/lib/comics/guess";
import type { InsightStory, StatRow, TapRow } from "@/lib/comics/insights";
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

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

export const GET = ownerRoute(async ({ admin }) => {
  const { data: rows, error } = await admin
    .from("comic_stories")
    .select("ep,title,themes,cast_names,release_at,guess,print_shortlist")
    .eq("collection", "weekly")
    .order("ep", { ascending: true })
    .returns<StoryRow[]>();
  // A missing column or table is the migration that hasn't run yet.
  if (error)
    return refuse(503, error.code === "42703" ? "insights_unavailable" : "service_unavailable");

  const stats = await allRows<StatRow>(
    (from, to) =>
      admin
        .from("comic_story_stats")
        .select("ep,week,metric,bucket,count")
        .order("ep", { ascending: true })
        .order("week", { ascending: true })
        .order("metric", { ascending: true })
        .order("bucket", { ascending: true })
        .range(from, to)
        .returns<StatRow[]>(),
    (r) => `${r.ep}|${r.week}|${r.metric}|${r.bucket}`
  );
  if (!stats) return refuse(503, "insights_unavailable");

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
  const numbers = (list: StatRow[] | TapRow[]) =>
    list.map((r) => ({ ...r, count: Number(r.count) || 0 }));
  return answer({ stories, stats: numbers(stats), taps: numbers(taps) });
});
