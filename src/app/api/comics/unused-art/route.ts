/**
 * Files in the bucket no story points at, after replacing art or deleting a
 * draft. Nothing removes them by itself: replaced art stays until the owner
 * looks at this list and says so.
 *
 * GET:  { files: [{ path, size, createdAt }] }
 * POST: { paths: [...] } deletes those, skipping any a story uses by now.
 *
 * A file younger than a day isn't listed: it may be an upload whose story is
 * still being saved, or sitting in a draft on the owner's phone.
 *
 * Errors: 400 invalid_paths, 401/403 not the owner, 503.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isArtPath } from "@/lib/comics/story-input";
import { BUCKET, answer, artPaths, loadStories, ownerRoute, readJson, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const MAX_FILES = 20_000;
const MAX_DELETE = 500;
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

interface BucketFile {
  name: string;
  created_at?: string | null;
  metadata?: { size?: number } | null;
}

async function listBucket(admin: SupabaseClient): Promise<BucketFile[] | null> {
  const files: BucketFile[] = [];
  while (files.length < MAX_FILES) {
    const { data, error } = await admin.storage.from(BUCKET).list("", {
      limit: PAGE_SIZE,
      offset: files.length,
      sortBy: { column: "name", order: "asc" },
    });
    if (error || !data) return null;
    files.push(...(data as BucketFile[]));
    if (data.length < PAGE_SIZE) break;
  }
  return files;
}

export const GET = ownerRoute(async ({ admin }) => {
  const [files, stories] = await Promise.all([listBucket(admin), loadStories(admin)]);
  if (!files || !stories) return refuse(503, "service_unavailable");
  const used = new Set(stories.flatMap(artPaths));
  const cutoff = Date.now() - MIN_AGE_MS;
  return answer({
    files: files
      .filter((f) => isArtPath(f.name) && !used.has(f.name))
      .filter((f) => !f.created_at || Date.parse(f.created_at) < cutoff)
      .map((f) => ({
        path: f.name,
        size: f.metadata?.size ?? 0,
        createdAt: f.created_at ?? null,
      })),
  });
});

export const POST = ownerRoute(async ({ req, admin }) => {
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const raw = (read.body as { paths?: unknown } | null)?.paths;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DELETE) {
    return refuse(400, "invalid_paths");
  }
  if (!raw.every(isArtPath)) return refuse(400, "invalid_paths");

  const stories = await loadStories(admin);
  if (!stories) return refuse(503, "service_unavailable");
  const used = new Set(stories.flatMap(artPaths));
  const paths = (raw as string[]).filter((path) => !used.has(path));
  if (paths.length === 0) return answer({ removed: 0 });

  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) return refuse(503, "service_unavailable");
  return answer({ removed: paths.length });
});
