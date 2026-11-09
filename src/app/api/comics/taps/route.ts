/**
 * POST /api/comics/taps: { ep, kind, choice }, one reader's guess or "Seen this
 * at work?" answer. Answers { counts, shares } for that story and kind.
 * GET /api/comics/taps?ep=N&kind=guess|seen: the same totals, for a reader
 * coming back to a story they've already answered.
 *
 * Reachable without a session through an exact-match middleware bypass, so this
 * handler is the whole gate: same-site Origin on writes, a per-instance rate
 * limit, a body cap, and an allowlist (lib/comics/guess parseTap) checked
 * against the story itself. Only a released weekly story counts, or one in the
 * VIP window for a device with the book's key. Nothing about the reader is
 * stored: no IP address, no user agent, no cookie. The browser remembers what
 * it answered (lib/comics/reading), which is all that stops a second tap.
 *
 * Errors: 400 invalid_json | invalid_input, 403 bad_origin, 404 not_found,
 * 413 body_too_large, 429 rate_limited, 503 service_unavailable.
 */

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  choicesFor,
  parseTap,
  readGuess,
  shares,
  tapCounts,
  type TapKind,
} from "@/lib/comics/guess";
import { storyOpenForCounts } from "@/lib/comics/story-access";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin, withinRateLimit } from "../_guard";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256;
/** A reader taps twice a story at most; an office shares one address. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const refuse = (status: number, error: string) => Response.json({ error }, { status });

const answer = (counts: number[], cache: string) =>
  Response.json({ counts, shares: shares(counts) }, { headers: { "cache-control": cache } });

/**
 * How many choices `kind` has on story `ep`, or a Response refusing it: a
 * number that isn't out (or in the reader's VIP window), or a guess on a story
 * without one.
 */
async function choicesOn(
  admin: SupabaseClient,
  ep: number,
  kind: TapKind
): Promise<number | Response> {
  const access = await storyOpenForCounts(admin, ep);
  if (!access.ok) return refuse(access.status, access.error);
  const size = choicesFor(kind, readGuess(access.story.guess));
  return size > 0 ? size : refuse(404, "not_found");
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return refuse(403, "bad_origin");
  if (!withinRateLimit(req, "taps", RATE_LIMIT, RATE_WINDOW_MS)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "body_too_large");
    return refuse(400, "invalid_json");
  }
  const tap = parseTap(body);
  if (!tap) return refuse(400, "invalid_input");

  const admin = getSquadAdminClient();
  if (!admin) return refuse(503, "service_unavailable");
  const size = await choicesOn(admin, tap.ep, tap.kind);
  if (size instanceof Response) return size;
  if (tap.choice >= size) return refuse(400, "invalid_input");

  const { data, error } = await admin.rpc("comic_story_tap", {
    p_ep: tap.ep,
    p_kind: tap.kind,
    p_choice: tap.choice,
  });
  if (error) {
    console.warn("[comics] tap failed:", error.message);
    return refuse(503, "service_unavailable");
  }
  const rows = ((data ?? []) as { tap_choice: number; tap_count: number | string }[]).map((r) => ({
    choice: r.tap_choice,
    count: r.tap_count,
  }));
  return answer(tapCounts(rows, size), "no-store");
}

export async function GET(req: NextRequest) {
  if (!withinRateLimit(req, "taps-read", RATE_LIMIT, RATE_WINDOW_MS)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } }
    );
  }
  const params = req.nextUrl.searchParams;
  const tap = parseTap({ ep: Number(params.get("ep")), kind: params.get("kind"), choice: 0 });
  if (!tap) return refuse(400, "invalid_input");

  const admin = getSquadAdminClient();
  if (!admin) return refuse(503, "service_unavailable");
  const size = await choicesOn(admin, tap.ep, tap.kind);
  if (size instanceof Response) return size;

  const { data, error } = await admin
    .from("comic_story_taps")
    .select("choice,count")
    .eq("ep", tap.ep)
    .eq("kind", tap.kind)
    .returns<{ choice: number; count: number | string }[]>();
  if (error) return refuse(503, "service_unavailable");
  // Private: a VIP's answer for a story still in its window mustn't be cached for everyone.
  return answer(tapCounts(data ?? [], size), "private, max-age=30");
}
