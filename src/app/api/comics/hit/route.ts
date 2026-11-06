/**
 * POST /api/comics/hit: one anonymous visit count.
 *
 * Reachable without a session through an exact-match middleware bypass. Takes a
 * page, the printed piece that led there and an episode, all from an allowlist
 * (lib/comics/visits), adds one to this month's total, and answers without a
 * cookie. No IP address or user agent reaches the database. The browser never
 * reads the answer, so failures stay quiet.
 */

import type { NextRequest } from "next/server";
import { parseVisit } from "@/lib/comics/visits";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin, withinRateLimit } from "../_guard";

const MAX_BODY_BYTES = 256;
/** Generous: a group scanning posters together shares one office Wi-Fi address. */
const RATE_LIMIT = 120;
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
  const visit = parseVisit(body);
  if (!visit) return refuse(400, "invalid_input");

  const admin = getSquadAdminClient();
  if (!admin) return quiet();

  const { error } = await admin.rpc("comic_visit_hit", {
    p_path: visit.path,
    p_src: visit.src,
    p_ep: visit.ep,
  });
  if (error) console.warn("[comics] visit count failed:", error.message);
  return quiet();
}
