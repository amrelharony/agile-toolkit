/**
 * GET /api/comics/guestbook-notes: every note, newest first, with how many are
 * waiting. Separate from /api/comics/guestbook, the public form's route, which
 * is on the middleware's bypass list by exact match. This one isn't.
 *
 * Errors: 401/403 not the owner, 503.
 */

import { answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const COLUMNS = "id,name,message,created_at,approved_at";
/** The cap on waiting notes in the form's route, plus the approved ones. */
const MAX_ROWS = 1000;

export const GET = ownerRoute(async ({ admin }) => {
  const { data, error } = await admin
    .from("comic_guestbook")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error || !data) return refuse(503, "service_unavailable");
  return answer({ notes: data, waiting: data.filter((row) => !row.approved_at).length });
});
