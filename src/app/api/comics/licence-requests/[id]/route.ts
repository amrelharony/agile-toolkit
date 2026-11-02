/**
 * PATCH  /api/comics/licence-requests/ID: { handled: boolean }.
 * DELETE /api/comics/licence-requests/ID: gone for good.
 *
 * Errors: 400 invalid_id | invalid_input, 404, 401/403 not the owner, 503.
 */

import { answer, ownerRoute, readJson, refuse } from "../../_owner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { id: string };

export const PATCH = ownerRoute<Params>(async ({ req, admin, params }) => {
  if (!UUID.test(params.id)) return refuse(400, "invalid_id");
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const handled = (read.body as { handled?: unknown } | null)?.handled;
  if (typeof handled !== "boolean") return refuse(400, "invalid_input");

  const { data, error } = await admin
    .from("comic_licence_requests")
    .update({ handled_at: handled ? new Date().toISOString() : null })
    .eq("id", params.id)
    .select("id,handled_at")
    .maybeSingle();
  if (error) return refuse(503, "service_unavailable");
  if (!data) return refuse(404, "not_found");
  return answer({ request: data });
});

export const DELETE = ownerRoute<Params>(async ({ admin, params }) => {
  if (!UUID.test(params.id)) return refuse(400, "invalid_id");
  const { error } = await admin.from("comic_licence_requests").delete().eq("id", params.id);
  if (error) return refuse(503, "service_unavailable");
  return answer({ deleted: true });
});
