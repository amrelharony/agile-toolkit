/**
 * POST /api/comics/upload-url: one signed URL for one converted image.
 *
 * Vercel caps a request body at about 4.5 MB, so images never pass through a
 * route: the browser sends them straight to Storage with this token. The path
 * is a fresh uuid, so nothing can be guessed or overwritten, and the bucket
 * itself only takes WebP and JPEG up to 5 MB (migration 0029).
 *
 * Errors: 400 invalid_type | invalid_json, 401/403 not the owner, 503.
 */

import { randomUUID } from "node:crypto";
import { BUCKET, answer, ownerRoute, readJson, refuse } from "../_owner";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

export const POST = ownerRoute(async ({ req, admin }) => {
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const contentType = (read.body as { contentType?: unknown } | null)?.contentType;
  const extension =
    typeof contentType === "string" && Object.hasOwn(EXTENSIONS, contentType)
      ? EXTENSIONS[contentType]
      : null;
  if (!extension) return refuse(400, "invalid_type");

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(`${randomUUID()}.${extension}`);
  if (error || !data) return refuse(503, "service_unavailable");
  return answer({ path: data.path, token: data.token });
});
