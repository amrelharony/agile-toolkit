/**
 * POST /api/comics/licence: a company asks for a licence.
 *
 * Reachable without a session through an exact-match middleware bypass, so this
 * handler is the whole gate: same-site Origin, a per-instance rate limit, a body
 * cap enforced while streaming, a honeypot, length limits, and a hard cap on
 * unhandled rows so spam can't fill the database. It stores what the person
 * typed and nothing about their browser: no IP address, no user agent.
 *
 * Errors:
 *   400 invalid_json | invalid_input (with `fields`)
 *   403 bad_origin
 *   413 body_too_large
 *   429 rate_limited
 *   503 inbox_full | service_unavailable
 */

import type { NextRequest } from "next/server";
import { validateLicenceDraft, type LicenceField } from "@/lib/comics/licence";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin, withinRateLimit } from "../_guard";

const MAX_BODY_BYTES = 16_384;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60_000;
/** About 1.5 MB at the longest allowed rows: nothing against a 500 MB database. */
const MAX_UNHANDLED = 500;

const refuse = (status: number, error: string, extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return refuse(403, "bad_origin");
  if (!withinRateLimit(req, "licence", RATE_LIMIT, RATE_WINDOW_MS)) {
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
  const draft = (body ?? {}) as Partial<Record<LicenceField | "website", unknown>>;

  // A person never sees this field. Answered like a success, so a bot learns
  // nothing, and stored nowhere.
  if (draft.website) return new Response(null, { status: 204 });

  const checked = validateLicenceDraft(draft);
  if (!checked.ok) return refuse(400, "invalid_input", { fields: Object.keys(checked.errors) });

  const admin = getSquadAdminClient();
  if (!admin) return refuse(503, "service_unavailable");

  const { count, error: countError } = await admin
    .from("comic_licence_requests")
    .select("id", { count: "exact", head: true })
    .is("handled_at", null);
  if (countError || count === null) return refuse(503, "service_unavailable");
  if (count >= MAX_UNHANDLED) return refuse(503, "inbox_full");

  const { values } = checked;
  const { error } = await admin.from("comic_licence_requests").insert({
    name: values.name,
    company: values.company,
    email: values.email,
    intended_use: values.intendedUse,
    team_size: values.teamSize,
    message: values.message,
  });
  if (error) return refuse(503, "service_unavailable");
  return new Response(null, { status: 204 });
}
