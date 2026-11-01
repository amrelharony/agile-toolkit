/**
 * GET /api/comics/licence-requests: the inbox, newest first, with how many are
 * waiting. Separate from /api/comics/licence, the public form's route, which is
 * on the middleware's bypass list by exact match. This one isn't.
 *
 * Errors: 401/403 not the owner, 503.
 */

import { answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const COLUMNS = "id,name,company,email,intended_use,team_size,message,created_at,handled_at";
/** Matches the cap on unhandled rows in the form's route, plus some handled ones. */
const MAX_ROWS = 800;

export const GET = ownerRoute(async ({ admin }) => {
  const { data, error } = await admin
    .from("comic_licence_requests")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error || !data) return refuse(503, "service_unavailable");
  return answer({
    requests: data,
    unhandled: data.filter((row) => !row.handled_at).length,
  });
});
