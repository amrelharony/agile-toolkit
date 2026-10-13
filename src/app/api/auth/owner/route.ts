/**
 * Is the caller the workspace owner?
 *
 *   GET /api/auth/owner   — 200 { owner: true }
 *                           401 unauthenticated
 *                           403 not_authorized | wrong_provider | email_unverified
 *                           503 auth_unavailable | auth_unreachable
 *
 * The browser asks this before treating a Supabase session as the owner. A
 * session in the browser only proves someone signed in to the project; the
 * allowlist (AUTHORIZED_EMAILS) is server-only by design, so the client cannot
 * check it itself. Every error is the shared `{ error, message }` JSON from
 * requireAuthorizedUser — and the middleware answers the same shape when it
 * stops the request first (no cookie, misconfigured, unreachable).
 */

import { NextResponse } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";

/** The answer depends on the caller's cookies: never prerender or cache it. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  return NextResponse.json({ owner: true }, { headers: { "cache-control": "no-store" } });
}
