/**
 * GET /api/comics/entries?months=12: visits month by month, by printed piece and
 * by episode, from the anonymous monthly totals, with the book's VIP link
 * activations (and the daily counts from before the monthly ones) beside them.
 * There is nothing about a visitor to return.
 *
 * Errors: 401/403 not the owner, 503.
 */

import {
  summariseVisits,
  type EntryCountRow,
  type VisitCountRow,
} from "@/lib/comics/entries-summary";
import { allRows, answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 60;

/** The first day of the month `back` months before this one, in UTC. */
function monthStart(back: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    .toISOString()
    .slice(0, 10);
}

export const GET = ownerRoute(async ({ req, admin }) => {
  const asked = Number(req.nextUrl.searchParams.get("months"));
  const months =
    Number.isInteger(asked) && asked >= 1 && asked <= MAX_MONTHS ? asked : DEFAULT_MONTHS;
  const since = monthStart(months - 1);

  const visits = await allRows<VisitCountRow>(
    (from, to) =>
      admin
        .from("comic_visit_counts")
        .select("month,path,src,ep,count")
        .gte("month", since)
        .order("month", { ascending: false })
        .order("path", { ascending: true })
        .order("src", { ascending: true })
        .order("ep", { ascending: true })
        .range(from, to)
        .returns<VisitCountRow[]>(),
    (r) => `${r.month}|${r.path}|${r.src}|${r.ep}`
  );
  if (!visits) return refuse(503, "service_unavailable");

  // The VIP link's daily counts, and the poster and direct ones from before 0034.
  const entries = await allRows<EntryCountRow & { building?: number }>(
    (from, to) =>
      admin
        .from("comic_entry_counts")
        .select("day,entry,ep,building,count")
        .gte("day", since)
        .order("day", { ascending: false })
        .order("entry", { ascending: true })
        .order("ep", { ascending: true })
        .order("building", { ascending: true })
        .range(from, to)
        .returns<(EntryCountRow & { building?: number })[]>(),
    (r) => `${r.day}|${r.entry}|${r.ep}|${r.building ?? 0}`
  );
  if (!entries) return refuse(503, "service_unavailable");

  return answer({ months, summary: summariseVisits(visits, entries) });
});
