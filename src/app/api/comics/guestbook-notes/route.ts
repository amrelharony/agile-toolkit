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
/** Above the form route's cap of 500 waiting, so every waiting note is here. */
const MAX_WAITING = 600;
/** The newest approved ones; older ones stay on the page all the same. */
const MAX_APPROVED = 300;

export const GET = ownerRoute(async ({ admin }) => {
  // Apart, so a long list of approved notes can never push a waiting one off.
  const [waiting, approved] = await Promise.all([
    admin
      .from("comic_guestbook")
      .select(COLUMNS)
      .is("approved_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_WAITING),
    admin
      .from("comic_guestbook")
      .select(COLUMNS)
      .not("approved_at", "is", null)
      .order("approved_at", { ascending: false })
      .limit(MAX_APPROVED),
  ]);
  if (waiting.error || approved.error || !waiting.data || !approved.data) {
    return refuse(503, "service_unavailable");
  }
  return answer({ notes: [...waiting.data, ...approved.data], waiting: waiting.data.length });
});
