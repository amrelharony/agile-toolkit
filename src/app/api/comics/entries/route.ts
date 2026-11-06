/**
 * GET /api/comics/entries?months=12: visits month by month, by printed piece and
 * by episode, from the anonymous monthly totals, with the book's VIP link
 * activations beside them. There is nothing about a visitor to return.
 *
 * Errors: 401/403 not the owner, 503.
 */

import {
  summariseVisits,
  type VipCountRow,
  type VisitCountRow,
} from "@/lib/comics/entries-summary";
import { answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 60;
/** PostgREST answers 1000 rows at most, whatever the query asks for. */
const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000;

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

  const visits: VisitCountRow[] = [];
  while (visits.length < MAX_ROWS) {
    const { data, error } = await admin
      .from("comic_visit_counts")
      .select("month,path,src,ep,count")
      .gte("month", since)
      .order("month", { ascending: false })
      .order("path", { ascending: true })
      .order("src", { ascending: true })
      .order("ep", { ascending: true })
      .range(visits.length, visits.length + PAGE_SIZE - 1)
      .returns<VisitCountRow[]>();
    if (error || !data) return refuse(503, "service_unavailable");
    visits.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  // One VIP row a day at most, so a page covers years of them.
  const { data: vip, error } = await admin
    .from("comic_entry_counts")
    .select("day,count")
    .eq("entry", "vip")
    .gte("day", since)
    .order("day", { ascending: false })
    .range(0, PAGE_SIZE - 1)
    .returns<VipCountRow[]>();
  if (error || !vip) return refuse(503, "service_unavailable");

  return answer({ months, summary: summariseVisits(visits, vip) });
});
