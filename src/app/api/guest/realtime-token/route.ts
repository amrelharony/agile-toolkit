/**
 * A Realtime room token for a squad guest.
 *
 *   POST /api/guest/realtime-token   { topics: string[] }
 *     200 { token, expiresAt, topics }
 *     400 invalid_json | invalid_input
 *     401 unauthenticated            no valid guest cookie
 *     403 topic_not_allowed          names the first topic the guest has no invite for
 *     413 body_too_large
 *     429 rate_limited
 *     503 private_rooms_unavailable  SUPABASE_JWT_SECRET is not set
 *
 * Guests have no Supabase identity, so the database policy on private
 * channels can't recognise them. The server checks every requested topic
 * against the guest's invites (lib/realtime/guest-room-access) and signs a
 * token naming exactly those topics in its `rooms` claim; the policy in
 * migration 0026 lets the holder join those and nothing else. The client
 * asks again, with the whole set, whenever it needs a new topic.
 *
 * `/api/guest/*` is on the middleware bypass list: this handler is the gate.
 */

import type { NextRequest } from "next/server";
import { getGuestSession } from "@/lib/auth/guest-session";
import { findRefusedGuestTopic, MAX_GUEST_TOPIC_LENGTH } from "@/lib/realtime/guest-room-access";
import { mintRoomToken, privateRoomsConfigured } from "@/lib/realtime/room-token";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { consumeGuestRateToken } from "../_rate-limit";

/** The answer depends on the caller's cookie: never prerender or cache it. */
export const dynamic = "force-dynamic";

const MAX_TOPICS = 8;
const MAX_BODY_BYTES = 16_384; // 8 topics of 300 characters is under 3 KiB.
const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** 1–8 distinct non-empty strings of at most 300 characters, else null. */
function parseTopics(body: unknown): string[] | null {
  const topics = (body as { topics?: unknown } | null)?.topics;
  if (!Array.isArray(topics)) return null;
  const unique: string[] = [];
  for (const topic of topics) {
    if (typeof topic !== "string" || topic.length === 0) return null;
    if (topic.length > MAX_GUEST_TOPIC_LENGTH) return null;
    if (!unique.includes(topic)) unique.push(topic);
    if (unique.length > MAX_TOPICS) return null;
  }
  return unique.length > 0 ? unique : null;
}

export async function POST(req: NextRequest) {
  if (!privateRoomsConfigured()) {
    return json(
      {
        error: "private_rooms_unavailable",
        message: "The server can't sign room tokens.",
      },
      503
    );
  }

  // Per IP before the cookie lookup (which costs a service-role query), then
  // per profile. Both buckets are this route's own, so a busy history log or
  // a squad redeeming codes behind the same NAT can't starve room joins.
  // x-real-ip first: the proxy sets it and a client can't (see /redeem).
  const realIp = req.headers.get("x-real-ip")?.trim();
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (realIp || fwd?.split(",")[0]?.trim() || "unknown").slice(0, 64);
  if (!consumeGuestRateToken(`realtime-token:ip:${ip}`)) {
    return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }

  const session = await getGuestSession();
  if (!session) {
    return json({ error: "unauthenticated" }, 401);
  }
  if (!consumeGuestRateToken(`realtime-token:profile:${session.profileId}`)) {
    return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return json({ error: "body_too_large" }, 413);
    }
    return json({ error: "invalid_json" }, 400);
  }

  const topics = parseTopics(body);
  if (!topics) {
    return json(
      {
        error: "invalid_input",
        message: `topics must be 1 to ${MAX_TOPICS} strings of at most ${MAX_GUEST_TOPIC_LENGTH} characters.`,
      },
      400
    );
  }

  const refused = await findRefusedGuestTopic(session, topics);
  if (refused !== null) {
    return json(
      {
        error: "topic_not_allowed",
        topic: refused,
        message: "No invite grants this room.",
      },
      403
    );
  }

  const { token, expiresAt } = mintRoomToken({ sub: session.profileId, rooms: topics });
  return json({ token, expiresAt, topics });
}
