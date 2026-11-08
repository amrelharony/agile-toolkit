/**
 * PUT /api/comics/stories/N/shortlist: { on } marks a weekly story as one the
 * owner is considering for a printed volume, or takes it off the list
 * (comic_stories.print_shortlist, migration 0036). Answers { ep, shortlisted }.
 * No page reads it.
 *
 * Errors: 400 invalid_ep | invalid_input | invalid_json, 401/403 not the owner,
 * 404 not_found, 413 body_too_large, 503 service_unavailable |
 * insights_unavailable (migration 0036 not applied).
 */

import { parseEp } from "@/lib/comics/entry";
import { answer, ownerRoute, readJson, refuse } from "../../../_owner";

export const dynamic = "force-dynamic";

type Params = { ep: string };

export const PUT = ownerRoute<Params>(async ({ req, admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const on = (read.body as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") return refuse(400, "invalid_input");

  const { data, error } = await admin
    .from("comic_stories")
    .update({ print_shortlist: on })
    .eq("ep", ep)
    .eq("collection", "weekly")
    .select("ep,print_shortlist")
    .maybeSingle<{ ep: number; print_shortlist: boolean }>();
  if (error) {
    return refuse(503, error.code === "42703" ? "insights_unavailable" : "service_unavailable");
  }
  if (!data) return refuse(404, "not_found");
  return answer({ ep: data.ep, shortlisted: data.print_shortlist });
});
