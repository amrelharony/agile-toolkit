/**
 * GET /api/comics/entries?days=30: scans by building, by episode and by day,
 * from the anonymous daily totals. There is nothing about a visitor to return.
 *
 * Errors: 401/403 not the owner, 503.
 */

import { summariseEntries, type EntryCountRow } from "@/lib/comics/entries-summary";
import { answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;
/** PostgREST answers 1000 rows at most, whatever the query asks for. */
const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000;

export const GET = ownerRoute(async ({ req, admin }) => {
  const asked = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isInteger(asked) && asked >= 1 && asked <= MAX_DAYS ? asked : DEFAULT_DAYS;
  const since = new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);

  const rows: EntryCountRow[] = [];
  while (rows.length < MAX_ROWS) {
    const { data, error } = await admin
      .from("comic_entry_counts")
      .select("day,entry,ep,building,count")
      .gte("day", since)
      .order("day", { ascending: false })
      .order("entry", { ascending: true })
      .order("ep", { ascending: true })
      .order("building", { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1)
      .returns<EntryCountRow[]>();
    if (error || !data) return refuse(503, "service_unavailable");
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return answer({ days, summary: summariseEntries(rows) });
});
