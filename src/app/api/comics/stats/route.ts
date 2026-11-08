/**
 * POST /api/comics/stats: { ep, events }, anonymous engagement on one weekly
 * story: a view, a first view from this browser, a first finish, a love or its
 * taking back, a share, a retro hand-off, a click on the story's tool, and a
 * band of active reading time (lib/comics/stats). Answers { loves, readers } for
 * that story, so the heart can show a fresh count.
 *
 * Reachable without a session through an exact-match middleware bypass, so this
 * handler is the whole gate: same-site Origin, a per-instance rate limit, a body
 * cap, an allowlist of events, per-story limits for each connection on the
 * events that matter (EVENT_LIMITS_PER_HOUR: an event over its limit is dropped,
 * the rest still count), and a story that's out. Nothing about the reader is
 * stored: no IP address, no user agent, no cookie, no device id; the limits'
 * addresses live in memory only (../_guard). The browser's own record
 * (lib/comics/reading) is what keeps an honest reader to one first view, finish
 * or love. Most calls are beacons, so going over the rate limit is a quiet 204,
 * as at /api/comics/hit, and so is a request whose events were all dropped.
 *
 * Errors: 400 invalid_json | invalid_input, 403 bad_origin, 404 not_found,
 * 413 body_too_large, 503 service_unavailable.
 */

import type { NextRequest } from "next/server";
import { EVENT_LIMITS_PER_HOUR, parseStats, type StatMetric } from "@/lib/comics/stats";
import { storyOpenForCounts } from "@/lib/comics/story-access";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin, withinRateLimit } from "../_guard";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256;
/** A few calls a story (view, finish, time, a love); an office shares one address. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const HOUR_MS = 3_600_000;

const refuse = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

type TotalsRow = { loves: number | string; readers: number | string };

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return refuse(403, "bad_origin");
  if (!withinRateLimit(req, "stats", RATE_LIMIT, RATE_WINDOW_MS)) {
    return new Response(null, { status: 204 });
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "body_too_large");
    return refuse(400, "invalid_json");
  }
  const stats = parseStats(body);
  if (!stats) return refuse(400, "invalid_input");

  const admin = getSquadAdminClient();
  if (!admin) return refuse(503, "service_unavailable");
  const access = await storyOpenForCounts(admin, stats.ep, { early: false });
  if (!access.ok) return refuse(access.status, access.error);

  const events = stats.events.filter((event) => {
    const limit = EVENT_LIMITS_PER_HOUR[event as StatMetric];
    return (
      limit === undefined || withinRateLimit(req, `stats:${stats.ep}:${event}`, limit, HOUR_MS)
    );
  });
  if (events.length === 0) return new Response(null, { status: 204 });

  const { data, error } = await admin.rpc("comic_story_stat", {
    p_ep: stats.ep,
    p_events: events,
  });
  if (error) {
    console.warn("[comics] stats failed:", error.message);
    return refuse(503, "service_unavailable");
  }
  const row = (Array.isArray(data) ? data[0] : data) as TotalsRow | undefined;
  return Response.json(
    { loves: Number(row?.loves ?? 0), readers: Number(row?.readers ?? 0) },
    { headers: { "cache-control": "no-store" } }
  );
}
