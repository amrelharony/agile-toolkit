/**
 * PATCH  /api/comics/guestbook-notes/ID: { approved: boolean }.
 * DELETE /api/comics/guestbook-notes/ID: gone for good.
 *
 * Either refreshes /comics/guestbook at once, so an approved note shows and a
 * taken-back one goes without waiting for the page's own refresh.
 *
 * Errors: 400 invalid_id | invalid_input, 404, 401/403 not the owner, 503.
 */

import { revalidatePath } from "next/cache";
import { GUESTBOOK_ROUTE } from "@/lib/comics/guestbook";
import { answer, ownerRoute, readJson, refuse } from "../../_owner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { id: string };

export const PATCH = ownerRoute<Params>(async ({ req, admin, params }) => {
  if (!UUID.test(params.id)) return refuse(400, "invalid_id");
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const approved = (read.body as { approved?: unknown } | null)?.approved;
  if (typeof approved !== "boolean") return refuse(400, "invalid_input");

  const { data, error } = await admin
    .from("comic_guestbook")
    .update({ approved_at: approved ? new Date().toISOString() : null })
    .eq("id", params.id)
    .select("id,approved_at")
    .maybeSingle();
  if (error) return refuse(503, "service_unavailable");
  if (!data) return refuse(404, "not_found");
  revalidatePath(GUESTBOOK_ROUTE);
  return answer({ note: data });
});

export const DELETE = ownerRoute<Params>(async ({ admin, params }) => {
  if (!UUID.test(params.id)) return refuse(400, "invalid_id");
  const { error } = await admin.from("comic_guestbook").delete().eq("id", params.id);
  if (error) return refuse(503, "service_unavailable");
  revalidatePath(GUESTBOOK_ROUTE);
  return answer({ deleted: true });
});
