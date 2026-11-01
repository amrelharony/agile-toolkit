/**
 * POST /api/comics/hit: one anonymous entry count.
 *
 * Reachable without a session through an exact-match middleware bypass. Takes a
 * way in, an episode and a building from an allowlist, adds one to today's
 * total, and answers without a cookie. No IP address or user agent reaches the
 * database. The browser never reads the answer, so failures stay quiet.
 */

import type { NextRequest } from "next/server";
import { parseHit } from "@/lib/comics/hit";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin, withinRateLimit } from "../_guard";

const MAX_BODY_BYTES = 256;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

const quiet = () => new Response(null, { status: 204 });
const refuse = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return refuse(403, "bad_origin");
  if (!withinRateLimit(req, "hit", RATE_LIMIT, RATE_WINDOW_MS)) return quiet();

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "body_too_large");
    return refuse(400, "invalid_json");
  }
  const hit = parseHit(body);
  if (!hit) return refuse(400, "invalid_input");

  const admin = getSquadAdminClient();
  if (!admin) return quiet();

  const { error } = await admin.rpc("comic_entry_hit", {
    p_entry: hit.entry,
    p_ep: hit.entry === "poster" ? hit.ep : 0,
    p_building: hit.entry === "poster" ? hit.b : 0,
  });
  if (error) console.warn("[comics] entry count failed:", error.message);
  return quiet();
}
