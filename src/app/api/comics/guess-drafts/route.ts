/**
 * GET /api/comics/guess-drafts: { eps }, the stories whose imported guess and
 * "Try it this week" line still wait for the owner, lowest number first.
 *
 * Its own route so the story list never depends on migration 0035: until it
 * runs, this answers 503 guess_unavailable and the portal shows nothing.
 *
 * Errors: 401/403 not the owner, 503 guess_unavailable.
 */

import { answer, ownerRoute, refuse } from "../_owner";

export const dynamic = "force-dynamic";

export const GET = ownerRoute(async ({ admin }) => {
  const { data, error } = await admin
    .from("comic_stories")
    .select("ep")
    .not("extras_draft", "is", null)
    .order("ep", { ascending: true })
    .returns<{ ep: number }[]>();
  if (error) return refuse(503, "guess_unavailable");
  return answer({ eps: (data ?? []).map((row) => row.ep) });
});
