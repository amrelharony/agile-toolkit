/**
 * POST /api/comics/guestbook: a reader leaves a note for the guestbook.
 *
 * Reachable without a session through an exact-match middleware bypass, so this
 * handler is the whole gate, like the licence form's: same-site Origin, a
 * per-instance rate limit, a body cap enforced while streaming, a honeypot,
 * length limits, and a cap on notes waiting for approval so spam can't fill the
 * database. Nothing is shown until the owner approves it, and nothing about the
 * browser is stored: no IP address, no user agent.
 *
 * Errors:
 *   400 invalid_json | invalid_input (with `fields`)
 *   403 bad_origin
 *   413 body_too_large
 *   429 rate_limited
 *   503 guestbook_full | service_unavailable
 */

import type { NextRequest } from "next/server";
import { validateGuestbookDraft, type GuestbookField } from "@/lib/comics/guestbook";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin, withinRateLimit } from "../_guard";

const MAX_BODY_BYTES = 4_096;
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60_000;
/** About 300 KB at the longest notes. */
const MAX_PENDING = 500;

const refuse = (status: number, error: string, extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return refuse(403, "bad_origin");
  if (!withinRateLimit(req, "guestbook", RATE_LIMIT, RATE_WINDOW_MS)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "3600" } }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "body_too_large");
    return refuse(400, "invalid_json");
  }
  const draft = (body ?? {}) as Partial<Record<GuestbookField | "website", unknown>>;

  // A person never sees this field. Answered like a success, and stored nowhere.
  if (draft.website) return new Response(null, { status: 204 });

  const checked = validateGuestbookDraft(draft);
  if (!checked.ok) return refuse(400, "invalid_input", { fields: Object.keys(checked.errors) });

  const admin = getSquadAdminClient();
  if (!admin) return refuse(503, "service_unavailable");

  const { count, error: countError } = await admin
    .from("comic_guestbook")
    .select("id", { count: "exact", head: true })
    .is("approved_at", null);
  if (countError || count === null) return refuse(503, "service_unavailable");
  if (count >= MAX_PENDING) {
    console.warn(`[comics] guestbook is full (${count} waiting): refusing new notes.`);
    return refuse(503, "guestbook_full");
  }

  const { error } = await admin
    .from("comic_guestbook")
    .insert({ name: checked.values.name, message: checked.values.message });
  if (error) return refuse(503, "service_unavailable");
  return new Response(null, { status: 204 });
}
